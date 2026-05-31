// T070 — Shared constants for group action handlers.
// Single source of truth for the group-kind enum + the draft-name placeholder
// referenced by create.ts and activate.ts. Schema source is migration 014_groups
// (groups.kind CHECK); keep this list in sync if the schema gains a kind.

export const GROUP_KINDS = [
  'place',
  'interest',
  'practice',
  'event_anchored',
  'family',
  'business',
] as const

export type GroupKind = (typeof GROUP_KINDS)[number]

// Placeholder for groups.name / group_businesses.display_name when the composer
// has not yet reached the brand-name step. group.activate refuses to promote a
// row that still carries this placeholder.
export const DRAFT_NAME_PLACEHOLDER = 'untitled-draft'
