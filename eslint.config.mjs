import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'coverage/**',
  ]),
  {
    files: [
      'app/dashboard/crm/page.tsx',
      'app/page.tsx',
      'app/reset-password/page.tsx',
      'components/brand-kit.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/purity': 'off',
    },
  },
])
