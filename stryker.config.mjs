// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.stryker.config.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.stryker.json',
  mutate: [
    'src/lib/**/*.ts',
    '!src/lib/**/*.test.ts',
    '!src/lib/supabase.ts',
    '!src/lib/supabase-server.ts',
    '!src/lib/types.ts',
    '!src/lib/map-config.ts',
  ],
  reporters: ['progress', 'clear-text', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  coverageAnalysis: 'perTest',
  timeoutMS: 10000,
  concurrency: 4,
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
}
