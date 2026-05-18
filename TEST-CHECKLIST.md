# Test / Eval Checklist

Manual and automated checks before shipping. Run through this before any deploy.

## Automated (must pass)

```bash
npm run test       # Unit tests
npm run lint       # Linting
npm run build      # Build succeeds
npm run eval       # Playwright evals
```

## Manual Smoke Tests

### F001: Map View

- [ ] Map loads with colored pins (green=independent, yellow=franchise, red=PE/corporate)
- [ ] Pins cluster at low zoom, expand on zoom in
- [ ] Map pans and zooms smoothly on mobile
- [ ] Search by category returns filtered results
- [ ] Search by location re-centers map
- [ ] Empty search state shows helpful message

### F002: Business Detail Card

- [ ] Tapping a pin opens the detail card
- [ ] Card shows: name, address, category, ownership badge, story
- [ ] Ownership badge color matches pin color
- [ ] Card dismisses on close/back tap
- [ ] Card links to shareable listing page

### F003: Business Registration

- [ ] Unauthenticated user is redirected to login
- [ ] Registration form validates required fields
- [ ] Ownership tier selector works (independent / franchise / PE-owned / corporate)
- [ ] Successful submission creates a pin on the map
- [ ] Duplicate address handling works gracefully

### F004: Shareable Listing

- [ ] `/business/[id]` renders SSR detail page
- [ ] Page has correct OG meta tags (title, description, image)
- [ ] Sharing URL on social media shows preview card
- [ ] Non-existent ID shows 404

### F005: Community Signals

- [ ] Heart/support button toggles on/off
- [ ] Heart count increments/decrements
- [ ] Unauthenticated user is prompted to log in
- [ ] "Report a concern" form opens
- [ ] Report requires selecting a pillar and reason
- [ ] Submitted report is stored in database

### Auth

- [ ] Sign up with email works
- [ ] Login with email works
- [ ] Sign out clears session
- [ ] Protected routes redirect to login
- [ ] Session persists on page refresh

### Cross-Cutting

- [ ] Mobile viewport (390x844) — no horizontal scroll, all UI reachable
- [ ] No console errors in normal flows
- [ ] Loading states shown during async operations
- [ ] Network errors show user-friendly messages
- [ ] No exposed API keys in client bundle (`npm run build` then inspect output)

## Playwright Eval Coverage

| Feature | Spec File | What It Tests |
|---------|-----------|---------------|
| F001 | `F001-map-view-colored-pins.spec.ts` | Pin rendering, colors |
| F001 | `F001-map-view-pin-clustering.spec.ts` | Cluster behavior |
| F001 | `F001-map-view-search.spec.ts` | Search by category/location |
| F002 | `F002-business-detail-card.spec.ts` | Card content, open/close |
| F003 | `F003-business-registration.spec.ts` | Form submission, validation |
| F003 | `F003-registration-auth.spec.ts` | Auth gating for registration |
| F004 | `F004-shareable-listing.spec.ts` | SSR page, OG tags |
| F005 | `F005-support-button.spec.ts` | Heart toggle |
| F005 | `F005-report-concern.spec.ts` | Report form |
