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
**Styling:** Tailwind CSS
**Database:** Supabase (Postgres + Auth + Realtime)
**Maps:** Mapbox GL JS
**Testing:** Playwright (evals), Vitest (unit)
**Deploy:** Vercel

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
