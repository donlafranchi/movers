// T089 — Interest-tag controlled vocabulary (F030). Initial b1 set.
// Tags match the member_interests CHECK (^[a-z0-9-]+$). Source: b1-themes.md.

export interface InterestTag {
  tag: string
  label: string
}

export const INTEREST_VOCAB: InterestTag[] = [
  { tag: 'farmers-market', label: 'Farmers markets' },
  { tag: 'live-music', label: 'Live music' },
  { tag: 'food-drink', label: 'Food & drink' },
  { tag: 'crafts', label: 'Crafts & makers' },
  { tag: 'gardening', label: 'Gardening' },
  { tag: 'kids-family', label: 'Kids & family' },
  { tag: 'fitness', label: 'Fitness & outdoors' },
  { tag: 'arts', label: 'Arts & culture' },
  { tag: 'volunteering', label: 'Volunteering' },
  { tag: 'small-business', label: 'Local business' },
  { tag: 'sustainability', label: 'Sustainability' },
  { tag: 'neighborhood', label: 'Neighborhood life' },
]

const VALID = new Set(INTEREST_VOCAB.map((t) => t.tag))

export function isVocabTag(tag: string): boolean {
  return VALID.has(tag)
}

/** Onboarding asks for 2–6 tags; the step is skippable (0 is valid). */
export const INTEREST_MIN = 2
export const INTEREST_MAX = 6
