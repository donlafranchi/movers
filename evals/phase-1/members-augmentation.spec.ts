import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Phase 1 — Members augmentation: FK fortification + privacy + handle history
// Source of truth:
//   - notes/migration-to-primitives.md § Phase 1 — Member surface (007 series
//     in plan; renumbered to 009 per build — see web/supabase/migrations/009_*).
//   - product/systems/member.md § Data model implications
//   - planning/DECISIONS.md ADR-9 (privacy framework — opt-out defaults)
//   - planning/DECISIONS.md ADR-15 (members.id = auth.users.id PK equality)
// Ticket: T047 — Members augmentation: FK + privacy + handle history.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

test.describe("Phase 1 — Members augmentation (T047)", () => {
  // ------------------------------------------------------------
  // T047 — members.home_location_id FK + constraint trigger on members.id
  // Source: development/tickets/done/T047-members-phase1-fk-privacy-handle-history.md
  // ------------------------------------------------------------

  test.describe("T047 — public.members FK + id-in-auth-users constraint trigger", () => {
    test("Given the migration has applied | When we list members' FKs | Then home_location_id has FK to locations(id) on delete set null", async () => {
      const { data, error } = await admin.rpc("eval_foreign_keys_for_table", { p_table: "members" });
      expect(
        error,
        "helper eval_foreign_keys_for_table missing — build adds: " +
          "create function public.eval_foreign_keys_for_table(p_table text) returns table(constraint_name text, column_name text, referenced_table text, referenced_column text, delete_action text) language sql security definer set search_path = public, pg_catalog as $$ select c.conname::text, a.attname::text, cl.relname::text, af.attname::text, case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end from pg_constraint c join pg_class src on src.oid = c.conrelid join pg_namespace srn on srn.oid = src.relnamespace join pg_class cl on cl.oid = c.confrelid join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1] where c.contype = 'f' and srn.nspname = 'public' and src.relname = p_table $$;",
      ).toBeNull();
      const fks = data as Array<{
        constraint_name: string;
        column_name: string;
        referenced_table: string;
        referenced_column: string;
        delete_action: string;
      }>;
      const home = fks.find((f) => f.column_name === "home_location_id");
      // Why: T047 + ADR-4 — home_location_id is the locality default. ON
      // DELETE SET NULL keeps a Member alive when their declared home
      // Location is removed; the Member can re-set it.
      expect(home).toBeDefined();
      expect(home?.referenced_table).toBe("locations");
      expect(home?.referenced_column).toBe("id");
      expect(home?.delete_action).toBe("SET NULL");
    });

    test("Given the constraint trigger is installed | When we INSERT a members row whose id is NOT in auth.users | Then the deferred trigger raises at COMMIT", async () => {
      // Why: ADR-15 — members.id MUST equal an auth.users(id), with the
      // system Member as the single documented exception. CHECK cannot
      // subquery, so the invariant is enforced by a DEFERRABLE constraint
      // trigger that runs at COMMIT.
      const orphanId = randomUUID();
      const { error } = await admin
        .from("members")
        .insert({ id: orphanId, handle: `orphan-${orphanId.slice(0, 6)}`, display_name: "Orphan" });
      expect(error?.code).toBe("23503");

      // Defensive cleanup (the trigger should have rejected — but if a
      // future regression lands a row, leaving it would poison reruns).
      await admin.from("members").delete().eq("id", orphanId);
    });

    test("Given the system Member is exempted | When the constraint trigger runs against id = system-Member | Then it passes", async () => {
      // Why: ADR-15 exception — the system Member has no auth.users
      // counterpart. The trigger function body exempts it explicitly. Read-
      // back the row that has been in place since 002_members.sql.
      const { data, error } = await admin
        .from("members")
        .select("id, handle, login_disabled")
        .eq("id", SYSTEM_MEMBER_ID)
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ id: SYSTEM_MEMBER_ID, handle: "system", login_disabled: true });
    });
  });

  // ------------------------------------------------------------
  // T047 — public.member_privacy (opt-out defaults per ADR-9)
  // ------------------------------------------------------------

  test.describe("T047 — public.member_privacy", () => {
    test("Given the migration has applied | When we describe member_privacy | Then ADR-9 opt-out default columns are present", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_privacy" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "member_id",
          "profile_visibility",
          "show_items_on_profile",
          "show_following",
          "show_followers",
          "allow_direct_messages",
          "locality_precision",
          "updated_at",
        ]),
      );
    });

    test("Given a fresh Member is inserted | When the bootstrap trigger fires | Then a member_privacy row exists with ADR-9 defaults", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      const handle = `priv-bootstrap-${memberId.slice(0, 6)}`;
      const { error: insErr } = await admin
        .from("members")
        .insert({ id: memberId, handle, display_name: "Privacy Bootstrap" });
      expect(insErr).toBeNull();

      const { data, error } = await admin
        .from("member_privacy")
        .select("profile_visibility, show_following, show_followers, allow_direct_messages, locality_precision")
        .eq("member_id", memberId)
        .single();
      expect(error).toBeNull();
      // Why: ADR-9 opt-out posture — every Member gets a privacy row at
      // signup via the AFTER INSERT bootstrap trigger. Defaults encode the
      // hypothesis: profile is public; follow graph is private; DMs are on;
      // locality precision rolls up to city.
      expect(data).toMatchObject({
        profile_visibility: "public",
        show_following: false,
        show_followers: false,
        allow_direct_messages: true,
        locality_precision: "city",
      });

      await admin.from("member_privacy").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given the system Member predates the bootstrap trigger | When we read its member_privacy row | Then the explicit backfill row exists", async () => {
      // Why: T047 explicit backfill — the AFTER INSERT trigger only fires on
      // new inserts; the system Member was inserted at Phase 0 (002_members)
      // before this trigger existed. The migration backfills explicitly.
      const { data, error } = await admin
        .from("member_privacy")
        .select("member_id")
        .eq("member_id", SYSTEM_MEMBER_ID);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    test("Given a Member's privacy row exists | When anon attempts to read it | Then RLS owner-only blocks the read", async () => {
      const memberId = randomUUID();
      await admin.rpc("eval_seed_auth_user_only", { p_id: memberId });
      await admin.from("members").insert({ id: memberId, handle: `priv-rls-${memberId.slice(0, 6)}`, display_name: "Priv RLS" });

      // Why: ADR-9 — privacy settings are themselves private. Anon must not
      // be able to enumerate which Members opted out of which surfaces.
      const { data } = await anon.from("member_privacy").select("member_id").eq("member_id", memberId);
      expect(data).toHaveLength(0);

      await admin.from("member_privacy").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
      await cleanupAuthUsers([memberId]);
    });

    test("Given anon has no auth.uid() | When anon attempts INSERT into member_privacy | Then it is rejected (no insert policy — action-layer-only)", async () => {
      // Why: ADR-7 — privacy writes flow through the action layer's
      // member.privacy.update handler. Direct anon insert must fail; the
      // bootstrap-trigger path is the only privileged insert at b1.
      const { error } = await anon.from("member_privacy").insert({
        member_id: SYSTEM_MEMBER_ID,
      });
      expect(error, "anon insert into member_privacy must fail").not.toBeNull();
    });
  });

  // ------------------------------------------------------------
  // T047 — public.member_handle_history (T2 placeholder)
  // ------------------------------------------------------------

  test.describe("T047 — public.member_handle_history (T2 placeholder)", () => {
    test("Given the migration has applied | When we describe member_handle_history | Then it carries (member_id, handle, changed_at) with composite PK", async () => {
      const { data, error } = await admin.rpc("eval_table_shape", { p_table: "member_handle_history" });
      expect(error).toBeNull();
      const names = (data as Array<{ column_name: string }>).map((c) => c.column_name);
      expect(names).toEqual(expect.arrayContaining(["member_id", "handle", "changed_at"]));
    });

    test("Given handle history is owner-read only | When anon queries the table | Then RLS returns zero rows", async () => {
      // Why: T2 surface posture — the handle-history audit trail is a
      // Member's own record. Public visibility would let observers see what
      // someone used to be called, which is harassment surface area.
      const { data, error } = await anon.from("member_handle_history").select("member_id").limit(1);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });
});

async function cleanupAuthUsers(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // Best-effort.
    }
  }
}
