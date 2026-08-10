import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Repo-wide config: `eslint .` from the root lints both workspaces.
  // Patterns are globbed from here, so they need `**/` to reach into
  // frontend/ and backend/. `.wrangler` holds generated dev-server bundles,
  // not source; `.terraform` is provider plugins vendored by `terraform init`.
  // `.claude/workflows` holds agent-orchestration scripts that are not ESM —
  // they run in a harness that allows top-level `return`, so ESLint reads every
  // one of them as a syntax error.
  globalIgnores(['**/dist', '**/.wrangler', '**/.terraform', '.claude/workflows']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    settings: {
      react: { version: 'detect' },
    },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { vars: 'all', args: 'after-used', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      // PropTypes are redundant in TypeScript projects; disable here since this repo uses plain JS
      // without a type-checker. Migrate to TypeScript to get compile-time prop validation instead.
      'react/prop-types': 'off',
    },
  },
])
