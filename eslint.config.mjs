import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const legacyClientSyncRules = {
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/exhaustive-deps': 'off',
  'react-hooks/static-components': 'off',
  'react-hooks/purity': 'off',
  'react/display-name': 'off',
  'react/jsx-no-comment-textnodes': 'off',
  '@next/next/no-img-element': 'off',
}

export default defineConfig([
  ...nextVitals,
  { rules: legacyClientSyncRules },
  globalIgnores(['.next/**', 'node_modules/**', 'coverage/**', 'supabase/functions/**']),
  {
    files: [
      'app/dashboard/crm/page.tsx', 'app/page.tsx', 'app/reset-password/page.tsx',
      'app/dashboard/settings/iara/page.tsx', 'app/dashboard/settings/integracoes/page.tsx',
      'app/dashboard/settings/seguranca/page.tsx', 'app/dashboard/settings/perfil/page.tsx',
      'components/brand-kit.tsx', 'components/brand-logo.tsx', 'app/dashboard/settings/page.tsx',
      'components/config-tab-performance.tsx', 'components/dashboard-mobile-modern.tsx',
      'components/sales-mobile.tsx', 'components/white-label-workspace.tsx',
    ],
    rules: { ...legacyClientSyncRules, 'react/no-unescaped-entities': 'off' },
  },
  { files: ['components/white-label-workspace.tsx'], rules: { 'react/jsx-key': 'off' } },
  { files: ['components/funnel-white-label-chat.tsx', 'components/funnels-mobile.tsx'], rules: {} },
  { files: ['postcss.config.mjs'], rules: { 'import/no-anonymous-default-export': 'off' } },
])
