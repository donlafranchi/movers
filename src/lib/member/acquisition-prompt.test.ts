// T095 — Prompt-on-acquisition substrate tests.
// Trace: product/systems/member.md § Prompt-on-acquisition for producers / organizers
//
// maybeEnqueueDiscoverabilityPrompt runs inside the membership transaction. We
// stub the pg-like client by dispatching on the SQL text: the existing-prompt
// probe, the qualifying-membership probe, and the insert.

import { describe, it, expect, vi } from 'vitest'
import { maybeEnqueueDiscoverabilityPrompt, type PgLike } from './acquisition-prompt'

function clientFrom(opts: { alreadyPrompted: boolean; qualifies: boolean }): {
  client: PgLike
  inserts: () => number
} {
  let insertCount = 0
  const client: PgLike = {
    query: vi.fn(async (text: string) => {
      if (text.includes('from public.member_prompts')) {
        return { rows: opts.alreadyPrompted ? [{ x: 1 }] : [] }
      }
      if (text.includes('from public.group_memberships')) {
        return { rows: opts.qualifies ? [{ x: 1 }] : [] }
      }
      if (text.includes('insert into public.member_prompts')) {
        insertCount += 1
        return { rows: [] }
      }
      return { rows: [] }
    }) as PgLike['query'],
  }
  return { client, inserts: () => insertCount }
}

describe('maybeEnqueueDiscoverabilityPrompt', () => {
  it('first qualifying membership (business or steward) enqueues the prompt', async () => {
    const { client, inserts } = clientFrom({ alreadyPrompted: false, qualifies: true })
    const enqueued = await maybeEnqueueDiscoverabilityPrompt(client, 'mem-1')
    expect(enqueued).toBe(true)
    expect(inserts()).toBe(1)
  })

  it('does NOT re-fire when a prompt row already exists (one per lifetime)', async () => {
    const { client, inserts } = clientFrom({ alreadyPrompted: true, qualifies: true })
    const enqueued = await maybeEnqueueDiscoverabilityPrompt(client, 'mem-1')
    expect(enqueued).toBe(false)
    expect(inserts()).toBe(0)
  })

  it('does NOT enqueue when the Member holds no qualifying role', async () => {
    const { client, inserts } = clientFrom({ alreadyPrompted: false, qualifies: false })
    const enqueued = await maybeEnqueueDiscoverabilityPrompt(client, 'mem-1')
    expect(enqueued).toBe(false)
    expect(inserts()).toBe(0)
  })

  it('short-circuits the qualifying probe when already prompted', async () => {
    const { client } = clientFrom({ alreadyPrompted: true, qualifies: true })
    const spy = client.query as unknown as ReturnType<typeof vi.fn>
    await maybeEnqueueDiscoverabilityPrompt(client, 'mem-1')
    const sqls = spy.mock.calls.map((c) => c[0] as string)
    expect(sqls.some((s) => s.includes('from public.group_memberships'))).toBe(false)
  })
})
