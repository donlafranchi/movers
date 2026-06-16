// T102 helper — extracted from saved-search-actions.ts so it lives outside the
// 'use server' module (Next 16 rejects non-async exports from a Server Actions
// file). Pure, sync, unit-testable. Fixed forward during T104 (build blocker).

const LABEL_MAX = 80

// Default label derived from the venue's name, truncated to the label CHECK
// ceiling (member.md § Saved searches). Private to the owner; editable at b2.
export function buildVenueFollowLabel(venueName: string): string {
  return `Following ${venueName}`.slice(0, LABEL_MAX)
}
