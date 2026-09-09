import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const legacyClientSyncRules = {
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/exhaustive-deps': 'off',
}

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
      'app/dashboard/settings/iara/page.tsx',
      'app/dashboard/settings/integracoes/page.tsx',
      'app/dashboard/settings/seguranca/page.tsx',
      'components/brand-kit.tsx',
      'components/brand-logo.tsx',
      'app/dashboard/settings/page.tsx',
      'components/config-tab-performance.tsx',
      'components/dashboard-mobile-modern.tsx',
      'components/dashboard-session-actions.tsx',
      'components/sales-mobile.tsx',
      'components/white-label-workspace.tsx',
    ],
    rules: {
      ...legacyClientSyncRules,
      'react/no-unescaped-entities': 'off',
      'react-hooks/purity': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
  {
    files: ['components/dashboard-session-actions.tsx'],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
  {
    files: ['components/white-label-workspace.tsx'],
    rules: {
      'react/jsx-key': 'off',
    },
  },
  {
    files: ['app/page.tsx'],
    rules: {
      ...legacyClientSyncRules,
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
