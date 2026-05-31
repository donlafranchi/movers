# web — Movers, Makers & Shakers

The deployable application. **Separate git repo** pushed to GitHub.

## Git

This directory has its own `.git/`. All git commands run from here.

```bash
cd web
git status
git commit
git push
```

`BUILD-LOG.md` lives here — update after completing tickets.

## Tech Stack

- **Framework:** Next.js (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 (`@theme inline` tokens in `globals.css`)
- **Database:** Supabase (Postgres + Auth + Realtime)
- **Maps:** Mapbox GL JS
- **Testing:** Playwright (evals), Vitest (unit)
- **Deploy:** Vercel

## Commands

```bash
npm run dev
npm run build
npm run test
npm run eval
npm run eval -- --grep "F001"   # one feature
npm run eval -- --watch
```

## Design System (non-negotiable)

- **DLS tokens only** from `globals.css` — never hardcode colors, spacing, radii, or shadows. Spec: [`product/ui/design-language.md`](../product/ui/design-language.md).
- **Component recipes:** `.btn-primary`, `.btn-secondary`, `.card`, `.card-hover`, `.chip`, `.chip-selected` — extend, don't duplicate.
- **Ownership tier colors** are reserved for badges + map pins only (`lib/map-config.ts` `PIN_COLORS`). Don't reuse as general accent colors.
- **Preserve `data-testid` and `data-extractive` attributes** — evals depend on them.
- **CTAs:** primary action = solid Tide; secondary = ghost. Member-signup CTAs follow DLS placement patterns.

## Directory Structure

```
web/
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # Shared UI components
│   ├── lib/              # Utilities, Supabase client, types
│   ├── hooks/            # Custom React hooks
│   └── styles/           # Global styles
├── tests/                # Unit tests (live next to code: Button.test.tsx)
├── evals/
│   ├── features/         # Playwright tests by feature
│   └── results/          # Test results
├── public/
└── BUILD-LOG.md
```

## Conventions

- Tests live next to code: `src/components/Button.test.tsx`.
- Commits: `T{NNN}: {title}` — one-line, no body, no co-author tag.
- Feature branches: `feature/F{N}-{slug}`.
- All commits reference a ticket.

## Writing a new API route

Four CI rules apply (per ticket T051; spec at `product/systems/action-layer.md`). A new `src/app/api/.../route.ts` must satisfy all four or build fails.

- **Rule 1 — credential boundary.** Do not import `pg` or bare `createClient` from `@supabase/supabase-js`, and do not reference `process.env.SUPABASE_SERVICE_ROLE_KEY`, outside `src/actions/_lib/**`. Type-only `pg` imports are allowed. Use `@supabase/ssr` helpers from `src/lib/*` for session-bound access.
- **Rule 2 — action-layer routing.** Any route that exports `POST`/`PUT`/`PATCH`/`DELETE` must `import ... from '@/actions/...'`. Pre-action-layer routes may carry `// action-layer:exempt — <reason>` annotation paired with a ledger entry in `scripts/action-layer-exemptions.json` (path / reason / expires_at / follow_up_ticket). Prefer delete over exempt.
- **Rule 3 — RLS coverage.** Every new public table ships with `enable row level security` plus at least one policy. Asserted by `tests/rls-coverage.test.ts` against the live DB.
- **Rule 4 — parameterized SQL.** Inside `.query` / `.rpc` template literals, use `$1, $2` placeholders. Identifier interpolation (`${table}`) requires a TypeScript union/enum and the annotation `// sql-injection-safe: enum-constrained by <TypeName>` placed on or directly above the call.

Run `npm run check:action-layer && npm run lint && npm test -- ci-enforcement rls-coverage` before committing.

## Mutation testing

`npm run mutate` runs Stryker against `src/lib/**` (excluding Supabase clients, `types.ts`, `map-config.ts`). It uses `vitest.stryker.config.ts` — a Vitest config covering both `src/**/*.test.ts(x)` and `tests/**/*.test.ts(x)` so the pre-existing pure-logic suites under `tests/` participate. The exclude list covers DB-bound migration suites (`tests/migrations-*.test.ts` — need a live Postgres) plus a small set of stale assertion tests pending T069 fix. Config: `stryker.config.mjs`. TS check uses `tsconfig.stryker.json` (extends base; narrows to `src/`). Local-only at b1; no CI gate. Report writes to `reports/mutation/index.html` (gitignored). Runs in `.stryker-tmp/` (gitignored) — safe to run alongside `npm run test:watch`. Surviving mutants are coverage-quality gaps, not build bugs; address by adding sibling `*.test.ts` files next to the file with the gap.
