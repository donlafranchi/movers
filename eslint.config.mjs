import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// T051 Rule 1 — service-role credentials and raw-pg imports forbidden
// outside `src/actions/_lib/**` and `scripts/**`. The bare `createClient`
// from `@supabase/supabase-js` is the service-role escape hatch; the
// session-bound `@supabase/ssr` clients in src/lib/* are allowed.
const RESTRICTED_PATHS = [
  {
    name: "pg",
    message:
      "Rule 1 (T051): runtime import of 'pg' is restricted to src/actions/_lib/** and scripts/**. Type-only imports (`import type { PoolClient } from 'pg'`) are allowed. Use the action layer for writes.",
    allowTypeImports: true,
  },
];

const SUPABASE_JS_MESSAGE =
  "Rule 1 (T051): bare `createClient` from @supabase/supabase-js is the service-role escape hatch. Use @supabase/ssr clients in src/lib/* for session-bound access; service-role lives only in src/actions/_lib/**.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    name: "T051 Rule 1 — credential boundary",
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [
      "src/actions/_lib/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: RESTRICTED_PATHS,
          patterns: [
            {
              group: ["@supabase/supabase-js"],
              importNames: ["createClient"],
              message: SUPABASE_JS_MESSAGE,
              allowTypeImports: true,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "Rule 1 (T051): process.env.SUPABASE_SERVICE_ROLE_KEY is restricted to src/actions/_lib/**. The service-role credential must never escape the action layer.",
        },
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SUPABASE_SECRET_KEY']",
          message:
            "Rule 1 (T051): process.env.SUPABASE_SECRET_KEY is restricted to src/actions/_lib/**.",
        },
      ],
    },
  },
]);

export default eslintConfig;
