// T043 — Handle derivation (pure function, unit-testable in isolation)
// Source: development/tickets/done/T043-* § member.create body
//
// Rules:
//   - Lowercase the email local-part.
//   - Strip characters not in [a-z0-9-].
//   - Replace runs of dots/underscores/spaces with a single hyphen.
//   - Trim leading/trailing hyphens.
//   - Pad to 4 chars if shorter (with 'u-' prefix for "user").
//   - Truncate to 30 chars.
//
// Collision resolution is a separate function — derive returns the base
// handle; the caller queries the DB and calls suffixForCollision to find
// the next available -N.

export function deriveHandleFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? 'user'
  let h = localPart
    .toLowerCase()
    // Any run of non-alnum-hyphen characters (dots, underscores, spaces, `+`,
    // anything else) collapses to a single hyphen. Preserves existing hyphens.
    .replace(/[^a-z0-9-]+/g, '-')
    // Collapse runs of hyphens that may now be adjacent.
    .replace(/-+/g, '-')
    // Trim leading/trailing hyphens.
    .replace(/^-+|-+$/g, '')

  if (h.length < 4) {
    h = `u-${h}`.padEnd(4, '0')
  }
  if (h.length > 30) {
    h = h.slice(0, 30).replace(/-+$/, '')
  }
  return h
}

export function deriveDisplayNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? 'User'
  const tidied = localPart.replace(/[._]+/g, ' ').trim()
  if (tidied.length === 0) return 'User'
  // First letter cap, rest as-is. Don't title-case the whole thing — that
  // mangles names like "McKinley" or "deLuca."
  return tidied.charAt(0).toUpperCase() + tidied.slice(1)
}

// Given a base handle, compute the suffixed handle for the given collision
// number. n=0 returns the base; n=1 returns base, n=2 returns "base-2", ...
// 99 is the max suffix before we give up.
export const MAX_HANDLE_COLLISION_SUFFIX = 99

export function suffixedHandle(base: string, n: number): string {
  if (n <= 1) return base
  if (n > MAX_HANDLE_COLLISION_SUFFIX) {
    throw new Error(
      `suffixedHandle: collision suffix ${n} exceeds MAX_HANDLE_COLLISION_SUFFIX (${MAX_HANDLE_COLLISION_SUFFIX})`,
    )
  }
  // Ensure the suffixed handle still fits in 30 chars.
  const suffix = `-${n}`
  const maxBaseLen = 30 - suffix.length
  const trimmed = base.length > maxBaseLen ? base.slice(0, maxBaseLen).replace(/-+$/, '') : base
  return `${trimmed}${suffix}`
}
