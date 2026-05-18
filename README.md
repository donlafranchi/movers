# Main Street Market

Map-based platform helping consumers find independently owned local businesses and distinguish them from PE-acquired or corporate-owned competitors.

## Prerequisites

- Node.js 20+
- npm 10+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Mapbox](https://mapbox.com) account (free tier: 50k map loads/mo)

## Setup

```bash
cd web
npm install
cp .env.local.example .env.local
```

Edit `.env.local` with your credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
SUPABASE_SECRET_KEY=sb_secret_your-key
NEXT_PUBLIC_MAPBOX_TOKEN=your-mapbox-token
```

### Supabase Setup

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Copy the project URL and publishable key from Settings > API
3. Run the database migrations (see `INFRASTRUCTURE.md` for schema details)

### Mapbox Setup

1. Create an account at [mapbox.com](https://mapbox.com)
2. Copy your default public token from your account page

## Development Server

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000). Hot-reloads on save.

## Build

```bash
npm run build    # Production build
npm run start    # Serve production build locally
```

## Testing

```bash
npm run test          # Vitest unit tests (single run)
npm run test:watch    # Vitest in watch mode
npm run lint          # ESLint
```

## Evals (Playwright)

```bash
npx playwright install    # First time only — installs browsers
npm run eval              # Run all Playwright tests
npm run eval:ui           # Interactive Playwright UI
npm run eval -- --grep "F001"   # Run tests for a specific feature
```

Evals run against `http://localhost:3000` (auto-starts dev server if needed).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase (Postgres + Auth) |
| Maps | Mapbox GL JS |
| Unit Tests | Vitest + Testing Library |
| E2E Tests | Playwright |
| Deploy | Vercel |
