# CLAUDE.md — mainstreetmarket/web

This is the deployable application. **This is a separate git repo** pushed to GitHub.

## Git Setup

This directory has its own `.git/`. All git commands run from here.

```bash
cd web
git status
git commit
git push
```

**BUILD-LOG.md lives here.** Update it after completing tickets.

## Quick Start

```bash
npm run dev
npm run build
npm run test
npm run eval
```

## Tech Stack

**Framework:** Next.js (App Router)
**Language:** TypeScript
**Styling:** Tailwind CSS v4 (`@theme inline` tokens in `globals.css`)
**Database:** Supabase (Postgres + Auth + Realtime)
**Maps:** Mapbox GL JS
**Testing:** Playwright (evals), Vitest (unit)
**Deploy:** Vercel

## Design System (non-negotiable)

- **All UI uses DLS tokens** from `globals.css` — never hardcode colors, spacing, radii, or shadows. See [product/ui/design-language.md](../product/ui/design-language.md) for the full spec and CTA placement playbook.
- **Component recipes:** `.btn-primary`, `.btn-secondary`, `.card`, `.card-hover`, `.chip`, `.chip-selected` — extend, don't duplicate.
- **Ownership tier colors** are reserved for badges + map pins only (see `lib/map-config.ts` `PIN_COLORS`). Don't reuse them as general accent colors.
- **Preserve `data-testid` and `data-extractive` attributes** — evals depend on them.
- **CTAs:** primary action = solid Tide; secondary = ghost. Member-signup CTAs follow the placement patterns in the DLS.

## Directory Structure

```
web/
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # Shared UI components
│   ├── lib/              # Utilities, Supabase client, types
│   ├── hooks/            # Custom React hooks
│   └── styles/           # Global styles
├── tests/                # Unit tests
├── evals/
│   ├── features/         # Playwright tests by feature
│   └── results/          # Test results
├── public/
├── package.json
├── tsconfig.json
└── BUILD-LOG.md
```

## Conventions

- Tests live next to code: `src/components/Button.test.tsx`
- Commits follow conventional format: `T{NNN}: {title}`
- Feature branches: `feature/F{N}-{slug}`
- All commits reference a ticket

## Running Evals

```bash
npm run eval
npm run eval -- --grep "F001"
npm run eval -- --watch
```
