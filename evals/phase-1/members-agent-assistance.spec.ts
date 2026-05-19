import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Agent-assistance substrate (member_self_records, member_delegations,
// + via_delegation_id FK retrofits onto member_events and location_events).
// Source of truth:
//   - notes/migration-to-primitives.md § Phase 1 — Member surface (007g + 007h
//     in the plan; consolidated to 012_member_agent_assistance.sql in the build).
//   - product/systems/member.md lines 351-393 (Member-owned context + Delegation)
//   - product/foundation/agent-assistance.md (parked at b1; substrate-only ship)
//   - planning/DECISIONS.md ADR-6  (Member-owned context, audit-field substrate)
//   - planning/DECISIONS.md ADR-7  (action-layer-only writes)
// Ticket: T050 — Agent-assistance substrate (012_member_agent_assistance.sql).
//
// Eval-writer firewall: no imports from web/src/. DB reads via service-role +
// RPC helpers in web/supabase/test-helpers/.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

test.describe("Phase 1 — Agent-assistance substrate (T050)", () => {
  // ------------------------------------------------------------
  // T050 — public.member_self_records (Member-owned context document)
  // Source: development/tickets/done/T050-member-agent-assistance-substrate.md
  // ------------------------------------------------------------

  test.describe("T050 — public.member_self_records", () => {
    test("Given the migration has applied | When we describe member_self_records | Then (member_id, document, scratch_or_full, updated_at) are present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_self_records" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining(["member_id", "document", "scratch_or_full", "updated_at"]),
      );
      // Why: T050 — document is jsonb (not text) so the action layer can store
      // structured Member-owned context with shape evolution unchanged by
      // migrations. Asserted to prevent a regression that drops it to text.
      const doc = cols.find((c) => c.column_name === "document");
      expect(doc?.data_type).toMatch(/jsonb/);
      // Why: member_id is the PK and the FK to members.id — cascading delete
      // tears down the Member's self-record when the Member is hard-deleted.
      const memberId = cols.find((c) => c.column_name === "member_id");
      expect(memberId?.is_nullable).toBe("NO");
    });

    test("Given the scratch_or_full enum is locked | When we attempt to insert scratch_or_full='other' | Then the CHECK rejects it", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `sr-en-${memberId.slice(0, 6)}`, display_name: "SR Enum" });

      // Why: member.md / T050 — the two-value enum encodes the b1 surface
      // commitment ("scratch" = ephemeral notes; "full" = curated context).
      // Adding a third value without a coordinated surface review would let
      // the action handler accept undefined behaviour silently.
      const { error } = await admin
        .from("member_self_records")
        .insert({ member_id: memberId, document: {}, scratch_or_full: "other" });
      expect(error?.code).toBe("23514");

      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given a fresh Member is created | When we read their member_self_records row | Then no row exists (deliberate no-bootstrap)", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `sr-nb-${memberId.slice(0, 6)}`, display_name: "SR No Bootstrap" });

      // Why: T050 — member_self_records is the only Member-related b1 table
      // that intentionally has NO bootstrap trigger. Most Members never opt
      // into agent assistance; auto-creating empty rows would create N empty
      // rows and an asymmetry consumers would have to defend against. The
      // row exists when the Member writes to it; absent otherwise. A future
      // agent reading the schema should not "fix" this by adding a trigger.
      const { data, error } = await admin
        .from("member_self_records")
        .select("member_id")
        .eq("member_id", memberId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the updated_at trigger reuses update_updated_at_column | When the row is updated | Then updated_at advances", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `sr-ut-${memberId.slice(0, 6)}`, display_name: "SR UpdatedAt" });

      // Service-role write — action layer doesn't exist for this surface at
      // b1 (agent assistance ships b2+), but the substrate's updated_at
      // trigger must already work so the b2 handler can rely on it.
      const { error: insErr } = await admin
        .from("member_self_records")
        .insert({ member_id: memberId, document: { initial: true } });
      expect(insErr).toBeNull();

      const { data: before } = await admin
        .from("member_self_records")
        .select("updated_at")
        .eq("member_id", memberId)
        .single();
      const firstStamp = before?.updated_at as string;

      // Brief pause so timestamp can change at second-precision.
      await new Promise((r) => setTimeout(r, 1100));

      const { error: updErr } = await admin
        .from("member_self_records")
        .update({ document: { initial: false, more: true } })
        .eq("member_id", memberId);
      expect(updErr).toBeNull();

      const { data: after } = await admin
        .from("member_self_records")
        .select("updated_at")
        .eq("member_id", memberId)
        .single();
      const secondStamp = after?.updated_at as string;

      // Why: T050 — reuses public.update_updated_at_column() defined in T042.
      // The action layer's `member.self_record.update` handler (b2) trusts
      // updated_at as the freshness signal; a regression that drops the
      // trigger would let stale documents render as fresh.
      expect(new Date(secondStamp).getTime()).toBeGreaterThan(new Date(firstStamp).getTime());

      await admin.from("member_self_records").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given an owner's self-record exists | When anon attempts to SELECT | Then RLS returns zero rows", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `sr-rls-${memberId.slice(0, 6)}`, display_name: "SR RLS" });
      await admin.from("member_self_records").insert({ member_id: memberId, document: { secret: true } });

      // Why: T050 — the Member-owned context document is sensitive by
      // construction (it's the prompt-time substrate for an LLM acting on
      // the Member's behalf). Peer or anon read would let an observer learn
      // a Member's stated preferences, frequented places, family details.
      const { data, error } = await anon
        .from("member_self_records")
        .select("member_id")
        .eq("member_id", memberId);
      expect(error).toBeNull();
      expect(data).toEqual([]);

      await admin.from("member_self_records").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the table has no insert/delete policy | When anon attempts INSERT | Then it is rejected (action-layer-only)", async () => {
      // Why: ADR-7 — writes flow through member.self_record.update only.
      // Direct anon insert / delete must fail so audit-field invariants
      // (acting_member_id, via_delegation_id, same-transaction event-row
      // commit) are never bypassed by a future contributor convenience path.
      const probeId = randomUUID();
      const { error } = await anon.from("member_self_records").insert({ member_id: probeId, document: {} });
      expect(error, "anon insert into member_self_records must fail").not.toBeNull();
    });
  });

  // ------------------------------------------------------------
  // T050 — public.member_delegations (scoped expiring permission grants)
  // ------------------------------------------------------------

  test.describe("T050 — public.member_delegations", () => {
    test("Given the migration has applied | When we describe member_delegations | Then the scoped-grant column set is present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_delegations" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "member_id",
          "grantee_label",
          "scopes",
          "granted_at",
          "expires_at",
          "revoked_at",
          "metadata",
        ]),
      );
    });

    test("Given the scopes CHECK requires array_length >= 1 | When we attempt to insert an empty scopes array | Then the CHECK rejects it", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `del-${memberId.slice(0, 6)}`, display_name: "Del Probe" });

      // Why: T050 — an empty scopes array would describe a Delegation that
      // grants nothing; allowing it would create rows the action layer must
      // defend against on every read. The schema rejects the meaningless
      // state at the floor so downstream code can assume scopes is non-empty.
      const { error } = await admin
        .from("member_delegations")
        .insert({ member_id: memberId, grantee_label: "Empty Scopes", scopes: [] });
      expect(error?.code).toBe("23514");

      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the grantee_label CHECK bounds 1..120 chars | When we attempt to insert an empty grantee_label | Then the CHECK rejects it", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `del-gl-${memberId.slice(0, 6)}`, display_name: "Del Label Probe" });

      // Why: T050 — the grantee_label is the Member-visible name on the
      // Delegation's own surface ("Revoke 'Maya's Assistant'"). An empty
      // label would surface as a Delegation the Member cannot identify;
      // length 1..120 bounds the surface affordance at the floor.
      const { error } = await admin
        .from("member_delegations")
        .insert({ member_id: memberId, grantee_label: "", scopes: ["item.read"] });
      expect(error?.code).toBe("23514");

      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the active-delegations partial index exists | When we list indexes | Then idx_delegations_member_active filters where revoked_at IS NULL only", async () => {
      const { data, error } = await admin.rpc("eval_indexes_for_table", { p_table: "member_delegations" });
      expect(error).toBeNull();
      const idx = data as Array<{ indexname: string; indexdef: string }>;
      const active = idx.find((r) => r.indexname === "idx_delegations_member_active");
      // Why: T050 § Notes — Postgres evaluates partial-index predicates at
      // INSERT time, not query time. A `where expires_at > now()` predicate
      // would be stale by definition; member.md's original phrasing was
      // dropped in favor of `where revoked_at is null` only. Asserting the
      // simplified predicate prevents a future agent from "fixing" the
      // index back to the broken shape.
      expect(active).toBeDefined();
      expect(active?.indexdef).toMatch(/where \(revoked_at is null\)/i);
      expect(active?.indexdef).not.toMatch(/expires_at/i);
    });

    test("Given a Member's delegation rows exist | When anon attempts to SELECT | Then RLS returns zero rows (no public-read policy)", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `del-rls-${memberId.slice(0, 6)}`, display_name: "Del RLS" });

      await admin.from("member_delegations").insert({
        member_id: memberId,
        grantee_label: "Sensitive Grantee",
        scopes: ["item.read", "item.publish"],
      });

      // Why: T050 — Delegations carry the full surface of what non-human
      // actors can do on a Member's behalf. Peer-readable would let bad
      // actors enumerate "which Members have which agent capabilities" —
      // direct reconnaissance for prompt-injection / capability-misuse
      // attacks. Owner-only is the structural floor; any future cross-Member
      // access lands as a SECURITY DEFINER scalar function, not by opening
      // the table.
      const { data, error } = await anon
        .from("member_delegations")
        .select("id, scopes")
        .eq("member_id", memberId);
      expect(error).toBeNull();
      expect(data).toEqual([]);

      await admin.from("member_delegations").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the table has no insert/update/delete policy | When anon attempts INSERT | Then it is rejected (action-layer-only)", async () => {
      // Why: ADR-7 — Delegation grants / expiries / revocations flow through
      // member.delegation.grant / .revoke. Direct anon insert would bypass
      // both the scope-vocabulary validator (lives in the action handler,
      // not the schema — `scopes text[]` is open at the floor) and the
      // member.delegation_granted / _revoked event emission. T051's CI
      // enforcement makes this a project-wide invariant.
      const probeId = randomUUID();
      const { error } = await anon
        .from("member_delegations")
        .insert({ member_id: probeId, grantee_label: "anon", scopes: ["x"] });
      expect(error, "anon insert into member_delegations must fail").not.toBeNull();
    });
  });

  // ------------------------------------------------------------
  // T050 — via_delegation_id FK retrofits on the event-log tables
  // T042 + T045 reserved the columns; T050 lands the FK to member_delegations.
  // ------------------------------------------------------------

  test.describe("T050 — via_delegation_id FK retrofits on event-log tables", () => {
    test("Given member_delegations exists | When we list FKs on member_events | Then via_delegation_id references member_delegations(id) on delete set null", async () => {
      const { data, error } = await admin.rpc("eval_foreign_keys_for_table", { p_table: "member_events" });
      expect(error).toBeNull();
      const fks = data as Array<{
        constraint_name: string;
        column_name: string;
        referenced_table: string;
        referenced_column: string;
        delete_action: string;
      }>;
      const viaDelegation = fks.find((f) => f.column_name === "via_delegation_id");
      // Why: ADR-6 + T042 DEVIATIONS — the audit-field circle was reserved
      // at Phase 0 without an FK because member_delegations didn't exist
      // yet. T050 closes the circle; missing this FK would let event rows
      // claim "delegated by N" for non-existent Delegation IDs and silently
      // break the audit trail.
      expect(viaDelegation).toBeDefined();
      expect(viaDelegation?.referenced_table).toBe("member_delegations");
      expect(viaDelegation?.referenced_column).toBe("id");
      // Why: ADR-10 / T050 — event rows are append-only. A revoked or
      // hard-deleted Delegation must NOT cascade-delete the event rows that
      // reference it; ON DELETE SET NULL preserves the row with the audit
      // truth that "this write was originally delegated, the link is gone."
      expect(viaDelegation?.delete_action).toBe("SET NULL");
    });

    test("Given member_delegations exists | When we list FKs on location_events | Then via_delegation_id references member_delegations(id) on delete set null", async () => {
      const { data, error } = await admin.rpc("eval_foreign_keys_for_table", { p_table: "location_events" });
      expect(error).toBeNull();
      const fks = data as Array<{
        constraint_name: string;
        column_name: string;
        referenced_table: string;
        referenced_column: string;
        delete_action: string;
      }>;
      const viaDelegation = fks.find((f) => f.column_name === "via_delegation_id");
      // Why: T045 reserved this column without FK for the same reason as
      // T042 — Delegations didn't exist yet. T050 retrofits both tables in
      // one migration so the moment member_delegations exists the FK is
      // live everywhere it's reserved. Skipping either FK would leave a
      // table-level audit hole.
      expect(viaDelegation).toBeDefined();
      expect(viaDelegation?.referenced_table).toBe("member_delegations");
      expect(viaDelegation?.referenced_column).toBe("id");
      expect(viaDelegation?.delete_action).toBe("SET NULL");
    });

    test("Given via_delegation_id is nullable on event tables | When we describe member_events.via_delegation_id | Then is_nullable is YES", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_events" });
      expect(error).toBeNull();
      const cols = data as Array<{ column_name: string; is_nullable: string }>;
      const viaDelegation = cols.find((c) => c.column_name === "via_delegation_id");
      // Why: ADR-6 — system-emitted events (the system Member acting on
      // its own behalf, or any non-delegated human action) have NO
      // delegating Member. Nullable is the correct shape; a NOT NULL would
      // force every event-log writer to invent a placeholder Delegation,
      // which would itself break the audit truth.
      expect(viaDelegation?.is_nullable).toBe("YES");
    });

    test("Given a Delegation row is hard-deleted | When we read an event row that referenced it | Then via_delegation_id is NULL (ON DELETE SET NULL behaviour)", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `del-cas-${memberId.slice(0, 6)}`, display_name: "Del Cascade" });

      const { data: del, error: delErr } = await admin
        .from("member_delegations")
        .insert({ member_id: memberId, grantee_label: "Cascade Grantee", scopes: ["item.read"] })
        .select("id");
      expect(delErr).toBeNull();
      const delegationId = del?.[0]?.id as string;

      // Emit an event referencing the Delegation.
      const { error: evErr } = await admin.from("member_events").insert({
        member_id: memberId,
        event_kind: "member.delegation_granted",
        acting_member_id: memberId,
        via_delegation_id: delegationId,
        payload: {},
      });
      expect(evErr).toBeNull();

      // Hard-delete the Delegation (admin-only path; soft-delete is the
      // platform default but we exercise the FK's referential action here).
      await admin.from("member_delegations").delete().eq("id", delegationId);

      // Why: T050 § Notes — ON DELETE SET NULL keeps the event row alive
      // (event log is append-only per ADR-10) but nulls the broken pointer.
      // Asserting the side-effect protects the design choice; a regression
      // to ON DELETE CASCADE would silently delete the event row alongside
      // the Delegation — a structural audit-trail hole.
      const { data: ev } = await admin
        .from("member_events")
        .select("via_delegation_id, event_kind")
        .eq("member_id", memberId)
        .eq("event_kind", "member.delegation_granted");
      expect(ev?.[0]?.via_delegation_id).toBeNull();

      await admin.from("member_events").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });
  });
});

async function cleanupAuthUsers(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // Best-effort cleanup; the bootstrap script keeps row pollution scoped to dev.
    }
  }
}
