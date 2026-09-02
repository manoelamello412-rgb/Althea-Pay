import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'coverage/**',
    // Pre-Next.js legacy static control-panel files (superseded by app/, components/, lib/).
    'app.js',
    'funnel-tokens.js',
    'funnel-trash.js',
    'integrations.js',
    'integrations-ui.js',
    'realtime.js',
    'jest.config.js',
    // Supabase Edge Functions run in Deno and have their own runtime/linting model.
    'supabase/functions/**',
  ]),
  {
    files: ['app/page.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    files: ['app/reset-password/page.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['components/brand-kit.tsx'],
    rules: {
      'react-hooks/purity': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
])
