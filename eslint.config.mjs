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
  ]),
])
