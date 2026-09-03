import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'coverage/**',
    'supabase/functions/**',
  ]),
  {
    files: [
      'app/dashboard/crm/page.tsx',
      'app/page.tsx',
      'app/reset-password/page.tsx',
      'components/brand-kit.tsx',
      'components/brand-logo.tsx',
      'app/dashboard/settings/page.tsx',
      'components/dashboard-session-actions.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/purity': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
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
