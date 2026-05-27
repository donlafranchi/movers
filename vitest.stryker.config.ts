import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Stryker-only Vitest config. Scopes the run to in-source unit tests
// (src/**/*.test.ts(x)) — the surface Stryker mutates. Excludes the
// /tests directory (integration / migration / CI-enforcement) so a
// stale snapshot test there does not block a mutation run.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', '.stryker-tmp/**', 'reports/**', 'evals/**', 'tests/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
