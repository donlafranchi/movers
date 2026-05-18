import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID, createHmac } from "node:crypto";

// Phase 0 — AI-native floor invariants
// Source of truth: notes/migration-to-primitives.md § Phase 0 — AI-native floor
// Tickets referenced: T041 (extensions + embedding tables) · T042 (members + member_events floor + system Member) ·
//                     T043 (action layer scaffold + member.create handler) · T044 (auth signup hook)
//
// NOTE TO PM: Phase 0 has no `planning/scenarios/F{NNN}-*.md` file because it lands infrastructure
// rather than a user flow. The rebuild plan substitutes as the approved spec; the per-test traceability
// below cites both the plan and the ticket. If the PM wants formalized scenario coverage, escalate to
// `pipeline-plan` to author `planning/scenarios/F000-phase-0-floor.md` with the exit-criterion clauses
// converted to Given/When/Then.
//
// Eval-writer firewall: this file does not import from web/src/. It reaches the DB and the auth
// signup route via service-role and HTTP helpers in web/evals/helpers/, which the build agent provisions.
// If a helper this spec needs is missing when the build runs, that is build's job to add — never paper
// over with an inline import from web/src/.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const AUTH_SIGNUP_HOOK_SECRET = process.env.AUTH_SIGNUP_HOOK_SECRET ?? "test-only-not-real";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

// The well-known system Member id per T042.
const SYSTEM_MEMBER_ID = "00000000-0000-0000-0000-000000000001";

let admin: SupabaseClient;
let anon: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

test.describe("Phase 0 — AI-native floor", () => {
  // ------------------------------------------------------------
  // T041 — Postgres extensions + embedding tables
  // ------------------------------------------------------------

  test.describe("T041 — Postgres extensions + embedding tables", () => {
    test("Given the migrations have applied | When we query pg_extension | Then pgvector and postgis are both enabled", async () => {
      const { data, error } = await admin.rpc("eval_pg_extensions");
      expect(error, `helper eval_pg_extensions missing — build adds: select extname from pg_extension where extname in ('vector','postgis')`).toBeNull();
      const names = (data as Array<{ extname: string }>).map((r) => r.extname);
      expect(names).toEqual(expect.arrayContaining(["vector", "postgis"]));
    });

    test("Given the migrations have applied | When we describe item_embeddings | Then it has (item_id, model_version, embedding vector(1536), created_at) with composite PK", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "item_embeddings" });
      expect(error, "helper eval_table_shape missing — build provisions").toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(expect.arrayContaining(["item_id", "model_version", "embedding", "created_at"]));
      const embedding = cols.find((c) => c.column_name === "embedding");
      expect(embedding?.data_type).toMatch(/vector/);
    });

    test("Given the migrations have applied | When we describe member_embeddings | Then it mirrors item_embeddings against member_id", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_embeddings" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(expect.arrayContaining(["member_id", "model_version", "embedding", "created_at"]));
      const embedding = cols.find((c) => c.column_name === "embedding");
      expect(embedding?.data_type).toMatch(/vector/);
    });
  });

  // ------------------------------------------------------------
  // T042 — Members + member_events floor + system Member
  // ------------------------------------------------------------

  test.describe("T042 — Members + member_events floor + system Member", () => {
    test("Given the migrations have applied | When we describe members | Then the b1 T1 column set is present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "members" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "handle",
          "display_name",
          "bio",
          "avatar_url",
          "pronouns",
          "home_location_id",
          "primary_group_id",
          "stakeholder_visibility",
          "maker_mode_enabled",
          "embedding_id",
          "login_disabled",
          "deleted_at",
          "created_at",
          "updated_at",
        ]),
      );
    });

    test("Given the migrations have applied | When we attempt to insert a duplicate handle | Then the unique constraint rejects it", async () => {
      const probeId = randomUUID();
      const secondId = randomUUID();
      // T047 (ADR-15): members.id must exist in auth.users before insert.
      // Seed auth.users rows via the test helper so the constraint trigger
      // members_assert_id_in_auth_users is satisfied at deferred-check time.
      await admin.rpc("eval_seed_auth_user_only", { p_id: probeId });
      await admin.rpc("eval_seed_auth_user_only", { p_id: secondId });

      const { error: firstInsert } = await admin
        .from("members")
        .insert({ id: probeId, handle: "phase0-probe", display_name: "Probe" });
      expect(firstInsert).toBeNull();

      const { error: secondInsert } = await admin
        .from("members")
        .insert({ id: secondId, handle: "phase0-probe", display_name: "Probe Two" });
      expect(secondInsert?.code).toBe("23505");

      await admin.from("members").delete().eq("id", probeId);
      await cleanupAuthUsers([probeId, secondId]);
    });

    test("Given the migrations have applied | When we describe member_events | Then the audit fields are NOT NULL and the table is partitioned", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_events" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "member_id",
          "event_kind",
          "payload",
          "acting_member_id",
          "via_delegation_id",
          "created_at",
        ]),
      );
      const acting = cols.find((c) => c.column_name === "acting_member_id");
      expect(acting?.is_nullable).toBe("NO");

      const { data: part, error: partErr } = await admin.rpc("eval_is_partitioned", { p_table: "member_events" });
      expect(partErr).toBeNull();
      expect(part).toBe(true);
    });

    test("Given the migrations have applied | When we select the system Member | Then exactly one row exists with handle='system' and login_disabled=true", async () => {
      const { data, error } = await admin
        .from("members")
        .select("id, handle, display_name, login_disabled")
        .eq("handle", "system");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({
        id: SYSTEM_MEMBER_ID,
        handle: "system",
        display_name: "System",
        login_disabled: true,
      });
    });

    test("Given the system Member exists | When anon queries members | Then the system Member is NOT returned (login_disabled excludes it from public read)", async () => {
      const { data, error } = await anon.from("members").select("id, handle").eq("handle", "system");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    test("Given the system Member exists | When we attempt to claim handle='system' | Then the insert is rejected by the unique constraint", async () => {
      const imposterId = randomUUID();
      // ADR-15: seed auth.users so the constraint trigger isn't what rejects
      // the insert — we want the unique violation on handle='system' to win.
      await admin.rpc("eval_seed_auth_user_only", { p_id: imposterId });
      const { error } = await admin
        .from("members")
        .insert({ id: imposterId, handle: "system", display_name: "Imposter" });
      expect(error?.code).toBe("23505");
      await cleanupAuthUsers([imposterId]);
    });

    test("Given the system Member was inserted by migration | When we read its bootstrap event | Then exactly one member.created event exists self-referencing as acting_member_id", async () => {
      const { data, error } = await admin
        .from("member_events")
        .select("event_kind, member_id, acting_member_id")
        .eq("member_id", SYSTEM_MEMBER_ID)
        .eq("event_kind", "member.created");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({
        event_kind: "member.created",
        member_id: SYSTEM_MEMBER_ID,
        acting_member_id: SYSTEM_MEMBER_ID,
      });
    });
  });

  // ------------------------------------------------------------
  // T043 — Action layer scaffold + member.create handler
  // ------------------------------------------------------------

  // SERIAL: the four collision-handling tests below share the `maya` handle
  // base. Under fullyParallel: true (playwright.config.ts), they race —
  // test "handle maya is already taken" inserts members(handle='maya') and
  // test "maya through maya-99 are all taken" seeds 99 rows including
  // handle='maya' + clears `maya%` between assertions. Running parallel
  // makes them clobber each other. Serial mode keeps the shared-state
  // invariants intact without losing parallelism on tests in other
  // describes. (T052 ADR-15 fix-forward 2026-05-18.)
  test.describe.serial("T043 — Action layer scaffold + member.create handler", () => {
    test("Given the action layer is the only write surface | When we run the conformance check | Then no direct writes to protected tables exist outside web/src/actions/", async () => {
      const { data, error } = await admin.rpc("eval_conformance_check_result");
      expect(error, "helper eval_conformance_check_result missing — build wires conformance script + result probe").toBeNull();
      expect(data).toMatchObject({ ok: true, violations: [] });
    });

    test("Given member.create is the proof-of-pattern handler | When we invoke it with a fresh auth user id | Then a members row and a member_events row are written in the same transaction with correct audit fields", async () => {
      const authUserId = randomUUID();
      const email = `phase0-${authUserId.slice(0, 8)}@example.test`;
      // ADR-15: provision auth.users for the handler to satisfy the
      // members_assert_id_in_auth_users trigger when it inserts the
      // members row. Helper bypasses the signup-hook so member.create
      // sees a clean slate (no pre-existing members row).
      await admin.rpc("eval_seed_auth_user_only", { p_id: authUserId, p_email: email });

      const res = await invokeMemberCreate({ authUserId, email });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { memberId: string; handle: string };
      expect(body.memberId).toBe(authUserId);
      expect(body.handle).toMatch(/^[a-z0-9-]{4,30}$/);

      const { data: m, error: mErr } = await admin
        .from("members")
        .select("id, handle, login_disabled")
        .eq("id", authUserId);
      expect(mErr).toBeNull();
      expect(m).toHaveLength(1);
      expect(m?.[0].login_disabled).toBe(false);

      const { data: ev, error: evErr } = await admin
        .from("member_events")
        .select("event_kind, member_id, acting_member_id, via_delegation_id")
        .eq("member_id", authUserId)
        .eq("event_kind", "member.created");
      expect(evErr).toBeNull();
      expect(ev).toHaveLength(1);
      expect(ev?.[0]).toMatchObject({
        event_kind: "member.created",
        member_id: authUserId,
        acting_member_id: authUserId,
        via_delegation_id: null,
      });

      await admin.from("member_events").delete().eq("member_id", authUserId);
      await admin.from("members").delete().eq("id", authUserId);
      await cleanupAuthUsers([authUserId]);
    });

    test("Given the event-log write fails | When member.create runs | Then the members row is rolled back (ADR-10 same-transaction invariant)", async () => {
      // Build wires an `eval_member_create_with_failure_injection` test-only helper that
      // calls the same action handler with a forced event-log write failure. Verifies
      // no members row remains.
      const probe = randomUUID();
      const { data, error } = await admin.rpc("eval_member_create_with_failure_injection", { p_id: probe });
      expect(error).toBeNull();
      expect(data).toMatchObject({ rolledBack: true, membersRowRemaining: false });
    });

    test("Given handle 'maya' is already taken | When member.create is called with email='maya@example.test' | Then the new row gets handle='maya-2'", async () => {
      const existingId = randomUUID();
      // ADR-15: seed auth.users for the existing-maya row so the direct
      // insert into members satisfies members_assert_id_in_auth_users.
      await admin.rpc("eval_seed_auth_user_only", { p_id: existingId });
      await admin.from("members").insert({ id: existingId, handle: "maya", display_name: "Existing Maya" });

      const newAuthId = randomUUID();
      // ADR-15: seed auth.users for the about-to-be-created member.create row.
      await admin.rpc("eval_seed_auth_user_only", { p_id: newAuthId, p_email: "maya@example.test" });
      const res = await invokeMemberCreate({ authUserId: newAuthId, email: "maya@example.test" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { handle: string };
      expect(body.handle).toBe("maya-2");

      await admin.from("member_events").delete().eq("member_id", newAuthId);
      await admin.from("members").delete().eq("id", newAuthId);
      await admin.from("members").delete().eq("id", existingId);
      await cleanupAuthUsers([existingId, newAuthId]);
    });

    test("Given handles maya through maya-99 are all taken | When member.create is called with email='maya@example.test' | Then it returns 409 ConflictError", async () => {
      // Build wires a helper that seeds the collision range and clears it after.
      // T052 fix-forward (ADR-15): the helper now seeds auth.users rows in
      // addition to public.members so the constraint trigger
      // members_assert_id_in_auth_users is satisfied for all 99 inserts.
      const { error: seedErr } = await admin.rpc("eval_seed_handle_collision_range", { p_base: "maya", p_count: 99 });
      expect(seedErr).toBeNull();

      const newAuthId = randomUUID();
      // ADR-15: the member.create handler about to be invoked needs an
      // auth.users row before its members insert satisfies the trigger.
      await admin.rpc("eval_seed_auth_user_only", { p_id: newAuthId, p_email: "maya@example.test" });
      const res = await invokeMemberCreate({ authUserId: newAuthId, email: "maya@example.test" });
      expect(res.status).toBe(409);

      await admin.rpc("eval_clear_handle_collision_range", { p_base: "maya" });
      await cleanupAuthUsers([newAuthId]);
    });

    test("Given an invalid email is passed | When member.create runs | Then it returns 400 ValidationError and no rows are written", async () => {
      const newAuthId = randomUUID();
      const res = await invokeMemberCreate({ authUserId: newAuthId, email: "not-an-email" });
      expect(res.status).toBe(400);

      const { data: m } = await admin.from("members").select("id").eq("id", newAuthId);
      expect(m).toHaveLength(0);
      const { data: ev } = await admin.from("member_events").select("id").eq("member_id", newAuthId);
      expect(ev).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------
  // T044 — Auth signup hook (Phase 0 exit-criterion eval)
  // ------------------------------------------------------------

  test.describe("T044 — Supabase Auth signup hook → member.create", () => {
    test("Given the auth signup hook is installed | When a fresh auth.users row is created | Then within 2 seconds a members row exists and member.created event has acting_member_id = <new id>", async () => {
      const email = `floor-${randomUUID().slice(0, 8)}@example.test`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: randomUUID(),
      });
      expect(createErr).toBeNull();
      const authUserId = created!.user!.id;

      const memberRow = await waitForRow(async () => {
        const { data } = await admin.from("members").select("id, handle").eq("id", authUserId).maybeSingle();
        return data;
      }, 2000);
      expect(memberRow, "members row not created within 2s of auth signup").not.toBeNull();

      const eventRow = await waitForRow(async () => {
        const { data } = await admin
          .from("member_events")
          .select("event_kind, member_id, acting_member_id, via_delegation_id")
          .eq("member_id", authUserId)
          .eq("event_kind", "member.created")
          .maybeSingle();
        return data;
      }, 2000);
      expect(eventRow).toMatchObject({
        event_kind: "member.created",
        member_id: authUserId,
        acting_member_id: authUserId,
        via_delegation_id: null,
      });

      await admin.from("member_events").delete().eq("member_id", authUserId);
      await admin.from("members").delete().eq("id", authUserId);
      await admin.auth.admin.deleteUser(authUserId);
    });

    test("Given the auth-signup hook route requires a signed payload | When POSTed without a valid x-signature | Then it returns 401 and no members row is created", async () => {
      const authUserId = randomUUID();
      const payload = { authUserId, email: `nosig-${authUserId.slice(0, 8)}@example.test` };
      const res = await fetch(`${APP_BASE_URL}/api/internal/auth-signup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": "deadbeef" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(401);

      const { data } = await admin.from("members").select("id").eq("id", authUserId);
      expect(data).toHaveLength(0);
    });

    test("Given a member.create was already run for auth user X | When the signup hook fires a second time for X | Then it returns 409 and exactly one members row + one member.created event exist", async () => {
      const authUserId = randomUUID();
      const email = `dupe-${authUserId.slice(0, 8)}@example.test`;
      // ADR-15: provision auth.users before the first invokeMemberCreate so
      // the constraint trigger lets the members row land. The signup-hook
      // is bypassed by the helper, so member.create is the first writer.
      await admin.rpc("eval_seed_auth_user_only", { p_id: authUserId, p_email: email });

      const r1 = await invokeMemberCreate({ authUserId, email });
      expect(r1.status).toBe(200);

      const r2 = await invokeMemberCreate({ authUserId, email });
      expect(r2.status).toBe(409);

      const { data: members } = await admin.from("members").select("id").eq("id", authUserId);
      expect(members).toHaveLength(1);
      const { data: events } = await admin
        .from("member_events")
        .select("id")
        .eq("member_id", authUserId)
        .eq("event_kind", "member.created");
      expect(events).toHaveLength(1);

      await admin.from("member_events").delete().eq("member_id", authUserId);
      await admin.from("members").delete().eq("id", authUserId);
      await cleanupAuthUsers([authUserId]);
    });
  });

  // ------------------------------------------------------------
  // RLS smoke — anon access to the Phase 0 floor
  // ------------------------------------------------------------

  test.describe("Phase 0 RLS smoke (anon vs auth-self vs auth-other on members)", () => {
    test("Given a human Member exists | When anon selects members | Then the row is returned (deleted_at IS NULL, login_disabled = false)", async () => {
      const probeId = randomUUID();
      // ADR-15: provision auth.users before the members insert.
      await admin.rpc("eval_seed_auth_user_only", { p_id: probeId });
      await admin.from("members").insert({ id: probeId, handle: `anon-probe-${probeId.slice(0, 6)}`, display_name: "Anon Probe" });

      const { data, error } = await anon.from("members").select("id, handle").eq("id", probeId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      await admin.from("members").delete().eq("id", probeId);
      await cleanupAuthUsers([probeId]);
    });

    test("Given anon has no auth.uid() | When anon attempts INSERT into members | Then it is rejected by RLS (no insert policy applies)", async () => {
      const { error } = await anon.from("members").insert({
        id: randomUUID(),
        handle: `anon-insert-${randomUUID().slice(0, 6)}`,
        display_name: "Should fail",
      });
      expect(error, "anon insert into members must fail").not.toBeNull();
    });

    test("Given anon has no auth.uid() | When anon attempts UPDATE on another Member's row | Then it is rejected by RLS", async () => {
      const probeId = randomUUID();
      // ADR-15: provision auth.users before the members insert.
      await admin.rpc("eval_seed_auth_user_only", { p_id: probeId });
      await admin.from("members").insert({ id: probeId, handle: `anon-upd-${probeId.slice(0, 6)}`, display_name: "Anon Upd Probe" });

      const { data: updated, error: updErr } = await anon.from("members").update({ display_name: "Hijacked" }).eq("id", probeId).select();
      // RLS rejects via 0 rows updated rather than an error code, depending on policy shape.
      expect(updErr === null && (updated ?? []).length === 0).toBeTruthy();

      await admin.from("members").delete().eq("id", probeId);
      await cleanupAuthUsers([probeId]);
    });
  });
});

// ------------------------------------------------------------
// Helpers — local to this spec. Build agent reproduces or refactors into web/evals/helpers/.
// ------------------------------------------------------------

async function invokeMemberCreate(input: { authUserId: string; email: string; handleSuggestion?: string; displayName?: string }) {
  const body = JSON.stringify(input);
  const signature = createHmac("sha256", AUTH_SIGNUP_HOOK_SECRET).update(body).digest("hex");
  return fetch(`${APP_BASE_URL}/api/internal/auth-signup`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature },
    body,
  });
}

async function waitForRow<T>(probe: () => Promise<T | null | undefined>, timeoutMs: number): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await probe();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// ADR-15 cleanup: after a test seeds auth.users via eval_seed_auth_user_only,
// it must also delete the row so subsequent runs don't accumulate. We use
// admin.auth.admin.deleteUser when available (the canonical path) and fall
// back to a direct delete via the service-role admin client. deleteUser also
// hits the supabase_auth_admin role's view, which handles cascading cleanup.
async function cleanupAuthUsers(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // Swallow — best-effort cleanup. The localhost guard on the bootstrap
      // script keeps the row pollution scoped to dev; a stale row here will
      // simply be on conflict do nothing on the next bootstrap.
    }
  }
}
