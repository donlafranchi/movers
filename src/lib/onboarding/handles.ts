// T089 — Handle validation + collision-suggestion helpers (F030). Pure.
// Mirrors the members.handle CHECK: 4..30 chars, ^[a-z0-9-]+$ (migration 002).

const HANDLE_RE = /^[a-z0-9-]+$/

export function validateHandle(h: string): boolean {
  return h.length >= 4 && h.length <= 30 && HANDLE_RE.test(h)
}

/** Deterministic 4-hex tail from a base string — no RNG (stable suggestions). */
function hexTail(base: string): string {
  let hash = 0
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).slice(0, 4).padStart(4, '0')
}

/** Up to 3 valid handle candidates for a taken base. Truncates to fit 30 chars. */
export function suggestHandles(base: string): string[] {
  const clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'member'
  const candidates = [`${clean}-2`, `${clean}-3`, `${clean}-${hexTail(clean)}`]
  return candidates
    .map((c) => (c.length > 30 ? c.slice(0, 30).replace(/-+$/, '') : c))
    .filter(validateHandle)
}
