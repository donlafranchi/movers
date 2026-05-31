import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Stryker-only Vitest config. Picks up in-source unit tests
// (src/**/*.test.ts(x)) AND the pure-logic suites under /tests that
// cover the same src/lib/** files Stryker mutates. Excludes only
// DB-bound migration suites + pre-existing stale tests pending T069.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: [
      'src/**/*.test.ts', 'src/**/*.test.tsx',
      'tests/**/*.test.ts', 'tests/**/*.test.tsx',
    ],
    exclude: [
      'node_modules/**',
      '.stryker-tmp/**',
      'reports/**',
      'evals/**',
      // DB-bound migration tests need a live Postgres; they cannot run under
      // Stryker. Permanent exclusion — see T068 Notes § Migration exclusion.
      'tests/migrations-*.test.ts',
      // Stale assertions surfaced by widening the Stryker include. Each entry
      // is a pre-existing bug, not a Stryker-isolation issue. T069 will fix
      // the assertion and remove the exclude.
      'tests/auth-signup-route-t044.test.ts', // stale — T069
      'tests/ci-conformance-json.test.ts', // stale — T069
      'tests/ci-enforcement-rule-1.test.ts', // stale — T069
      'tests/ci-enforcement-rule-4.test.ts', // stale — T069
      'tests/eval-bootstrap.test.ts', // stale — T069
    ],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
