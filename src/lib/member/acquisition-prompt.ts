// T095 — Prompt-on-acquisition substrate (producers / organizers).
// Spec: product/systems/member.md § Prompt-on-acquisition for producers / organizers
//       (Ratified 2026-06-03 — one-time offer, never an auto-flip).
//
// When a Member acquires their first qualifying role — any membership in a
// kind='business' Group, or a steward role in any Group — the membership action
// handler calls this in the SAME transaction as the membership insert. It
// enqueues exactly one member_prompts row (discoverability_on_acquisition,
// shown_at = null) which the next session surfaces. It never flips
// is_discoverable; the Member must consent explicitly via the prompt response.
//
// Idempotent and one-per-lifetime: the existing-prompt guard means a second
// business/steward acquisition never re-enqueues, and the on-conflict insert is
// a belt-and-suspenders against races. Greenfield (no pre-T095 memberships), so
// "qualifies now AND no prompt row yet" correctly identifies the first time.

export interface PgLike {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>
}

export async function maybeEnqueueDiscoverabilityPrompt(
  client: PgLike,
  memberId: string,
): Promise<boolean> {
  const existing = await client.query(
    `select 1 from public.member_prompts
      where member_id = $1 and prompt_kind = 'discoverability_on_acquisition'
      limit 1`,
    [memberId],
  )
  if (existing.rows.length > 0) return false

  const qualifies = await client.query(
    `select 1
       from public.group_memberships gm
       join public.groups g on g.id = gm.group_id
      where gm.member_id = $1
        and gm.left_at is null
        and (g.kind = 'business' or gm.role = 'steward')
      limit 1`,
    [memberId],
  )
  if (qualifies.rows.length === 0) return false

  await client.query(
    `insert into public.member_prompts (member_id, prompt_kind)
     values ($1, 'discoverability_on_acquisition')
     on conflict (member_id, prompt_kind) do nothing`,
    [memberId],
  )
  return true
}
