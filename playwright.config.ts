import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './evals',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Override the Next.js dev server's browser-bound public env to the
    // LOCAL Supabase instance during evals. .env.local's NEXT_PUBLIC_*
    // values point at the linked prod project for regular development;
    // without this override, eval seeds write to the local DB but the
    // page's signInWithPassword hits prod, gets "Invalid login
    // credentials," and every spec times out at signIn.
    env: {
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.SUPABASE_ANON_KEY ??
        process.env.SUPABASE_PUBLISHABLE_KEY ??
        '',
    },
  },
})
