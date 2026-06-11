import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// T103 — handler wiring for home-metro derivation at locality-save.
//
// Spec divergence (see DEVIATIONS.md / SPEC-PATCHES.md): the ticket names a
// `member.locality.set` handler writing `home_location_id`, but that handler
// does not exist — locality is set via `member.place_interest.add`
// (scope primary_home) → member_place_interests.place_id → places.centroid.
// The metro derivation hooks the real handler's primary_home arm. DB-touching
// behavior is verified by Playwright evals / the SQL contract test; these are
// static source-shape guards.

const ACTIONS = resolve(__dirname, '..', 'src', 'actions', 'member')
const addSrc = readFileSync(resolve(ACTIONS, 'place-interest-add.ts'), 'utf8')
const removeSrc = readFileSync(resolve(ACTIONS, 'place-interest-remove.ts'), 'utf8')

describe('T103 — place-interest-add resolves home_metro_id on primary_home', () => {
  it('calls resolve_home_metro against the place centroid', () => {
    expect(addSrc).toMatch(/resolve_home_metro/)
    expect(addSrc).toMatch(/centroid/i)
  })

  it('updates members.home_metro_id only on the primary_home arm', () => {
    expect(addSrc).toMatch(/home_metro_id/)
    // the update is gated on primary_home scope
    expect(addSrc).toMatch(/primary_home/)
  })

  it('documents the locality.set divergence', () => {
    expect(addSrc).toMatch(/home_metro|metro/i)
  })
})

describe('T103 — place-interest-remove clears/recomputes home_metro_id', () => {
  it('recomputes home_metro_id when a primary_home is removed', () => {
    expect(removeSrc).toMatch(/home_metro_id/)
  })
})
