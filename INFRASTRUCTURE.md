# Infrastructure Setup

Step-by-step guide to getting Main Street Market production-ready.

## Services Overview

| Service | Purpose | Tier | Estimated Cost |
|---------|---------|------|---------------|
| [Supabase](https://supabase.com) | Database, Auth, API | Free (up to 500MB, 50k MAU) | $0 → $25/mo |
| [Mapbox](https://mapbox.com) | Map tiles, geocoding | Free (50k loads/mo) | $0 → usage-based |
| [Vercel](https://vercel.com) | Hosting, CDN, edge functions | Free (hobby) | $0 → $20/mo |
| Domain registrar | Custom domain | - | ~$12/yr |

---

## 1. Supabase (Database + Auth)

### Create Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click "New Project"
3. Choose org, name it `mainstreetmarket`, pick nearest region
4. Save the generated database password

### Get API Keys

Settings > API:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **Publishable key** (`sb_publishable_...`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (safe for client-side)
- **Secret key** (`sb_secret_...`) → `SUPABASE_SECRET_KEY` (server-only, never expose client-side)

> Note: Legacy `anon` and `service_role` JWT keys still work during the transition period but new projects should use the publishable/secret keys.

### Database Schema

Run the SQL scripts from `web/scripts/` in order in the Supabase SQL Editor:

1. `001-create-tables.sql` — creates all tables, RLS policies, and indexes
2. `seed-folsom-coffee.sql` — populates 22 coffee shops in Folsom, CA for testing

Or see `web/scripts/001-create-tables.sql` for the full schema.

### Auth Setup

1. Authentication > Providers: Email is enabled by default
2. Authentication > URL Configuration:
   - Site URL: `https://yourdomain.com`
   - Redirect URLs: `https://yourdomain.com/**`, `http://localhost:3000/**`
3. Optional: enable Google/Apple OAuth under Providers

### Production Hardening

- [ ] Enable email confirmation (Authentication > Settings)
- [ ] Set up rate limiting (Database > Extensions > enable `pg_rate_limiter`)
- [ ] Add database indexes:

```sql
create index idx_businesses_location on businesses using gist (
  point(lng, lat)
);
create index idx_businesses_category on businesses (category);
create index idx_businesses_ownership on businesses (ownership_type);
create index idx_supports_business on supports (business_id);
```

---

## 2. Mapbox (Maps + Geocoding)

### Get Token

1. Sign up at [mapbox.com](https://mapbox.com)
2. Account page > Access tokens
3. Copy default public token → `NEXT_PUBLIC_MAPBOX_TOKEN`

### Production Token

For production, create a scoped token:
1. Click "Create a token"
2. Name: `mainstreetmarket-prod`
3. Scopes: `styles:tiles`, `styles:read`, `fonts:read`, `datasets:read`
4. URL restrictions: add your production domain
5. Copy → use as `NEXT_PUBLIC_MAPBOX_TOKEN` in Vercel env vars

### Pricing Watch

- Free: 50,000 map loads/month
- Overage: $5 per 1,000 loads
- Monitor usage at [account.mapbox.com/statistics](https://account.mapbox.com)

---

## 3. Vercel (Hosting)

### Connect Repo

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `web` GitHub repo
3. Framework preset: Next.js (auto-detected)
4. Root directory: `.` (the web repo is the root)

### Environment Variables

Add in Vercel dashboard (Settings > Environment Variables):

| Variable | Value | Environments |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | All |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | All |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | All |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `pk.eyJ...` | All |

### Custom Domain

1. Settings > Domains > Add
2. Enter your domain
3. Add the DNS records Vercel provides (CNAME or A record)
4. SSL is automatic

### Deploy Settings

- Build command: `npm run build`
- Output directory: `.next`
- Install command: `npm install`
- Node.js version: 20.x

---

## 4. Domain & DNS

Register a domain (Namecheap, Cloudflare, Google Domains — wherever).

DNS records (after Vercel setup):

```
Type    Name    Value
CNAME   @       cname.vercel-dns.com
CNAME   www     cname.vercel-dns.com
```

---

## 5. Production Environment Checklist

### Before Launch

- [ ] Supabase project created, schema migrated
- [ ] RLS policies verified (test with anon + auth roles)
- [ ] Database indexes created
- [ ] Email confirmation enabled
- [ ] Mapbox production token created with URL restrictions
- [ ] Vercel project connected to GitHub repo
- [ ] All 3 env vars set in Vercel
- [ ] Custom domain configured with SSL
- [ ] `npm run build` succeeds on Vercel
- [ ] OG meta images working (test with [opengraph.xyz](https://opengraph.xyz))

### After Launch

- [ ] Monitor Supabase usage (dashboard > Reports)
- [ ] Monitor Mapbox loads (account > Statistics)
- [ ] Monitor Vercel analytics (dashboard > Analytics)
- [ ] Set up Supabase alerts for DB size approaching limits
- [ ] Set up Vercel spend alerts if on Pro plan

### Optional Enhancements

- [ ] Add Sentry for error tracking (`@sentry/nextjs`)
- [ ] Add Plausible or PostHog for privacy-friendly analytics
- [ ] Enable Supabase backups (Pro plan, automatic daily)
- [ ] Set up Vercel preview deployments for PR branches
