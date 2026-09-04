import babelParser from '@babel/eslint-parser'
import js from '@eslint/js'
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import tanstackQueryPlugin from '@tanstack/eslint-plugin-query'
import tanstackRouterPlugin from '@tanstack/eslint-plugin-router'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import importPlugin from 'eslint-plugin-import-x'
import { openwagglePlugin } from './scripts/eslint/openwaggle-plugin'
import { readRendererDesignTokenExemptions } from './scripts/standards/renderer-design-token-exemptions'
import { tsMatchPlugin } from './scripts/eslint/ts-match-plugin'

// ESLint 10 and TanStack currently expose incompatible plugin type generations.
// ESLint validates the complete flat config when the lint command loads it.
const config: object[] = [
  {
    ignores: [
      'dist/**',
      'out/**',
      '.typecheck/**',
      'node_modules/**',
      'packages/**/.pack/**',
      'packages/**/dist/**',
      'packages/**/dist-cjs/**',
      'website/.astro/**',
      'website/dist/**',
      'website/node_modules/**',
      'src/renderer/src/routeTree.gen.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['fixtures/extensions/openwaggle-github-issues-overview/{modules,src}/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: [
      'src/**/*.{ts,tsx}',
      'packages/**/*.ts',
      'scripts/**/*.ts',
      'website/**/*.{ts,tsx}',
      'electron.vite.config.ts',
      'playwright.config.ts',
    ],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        babelOptions: {
          parserOpts: {
            plugins: ['typescript', 'jsx'],
          },
        },
        ecmaFeatures: {
          jsx: true,
        },
        requireConfigFile: false,
        sourceType: 'module',
      },
    },
    plugins: {
      'eslint-comments': eslintComments,
      'import-x': importPlugin,
      openwaggle: openwagglePlugin,
      'ts-match': tsMatchPlugin,
      '@tanstack/query': tanstackQueryPlugin,
      '@tanstack/router': tanstackRouterPlugin,
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['./tsconfig.node.json', './tsconfig.web.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      complexity: ['error', { max: 15 }],
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: false }],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: false }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-undef': 'off',
      'constructor-super': 'off',
      'getter-return': 'off',
      'no-class-assign': 'off',
      'no-const-assign': 'off',
      'no-dupe-args': 'off',
      'no-dupe-class-members': 'off',
      'no-dupe-keys': 'off',
      'no-func-assign': 'off',
      'no-import-assign': 'off',
      'no-new-native-nonconstructor': 'off',
      'no-obj-calls': 'off',
      'no-redeclare': 'off',
      'no-setter-return': 'off',
      'no-this-before-super': 'off',
      'no-unreachable': 'off',
      'no-unsafe-negation': 'off',
      'no-unused-vars': 'off',
      'no-var': 'error',
      'no-with': 'off',
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'eslint-comments/no-use': 'error',
      'openwaggle/function-name-convention': 'error',
      'openwaggle/no-architecture-ignore-comments': 'error',
      'openwaggle/main-architecture-boundaries': 'error',
      'openwaggle/no-inline-import-types': 'error',
      'openwaggle/no-inline-magic-numbers': 'error',
      'openwaggle/no-infinite-for-loop': 'error',
      'openwaggle/no-raw-renderer-buttons': 'error',
      'openwaggle/no-react-legacy-patterns': 'error',
      'openwaggle/no-shoehorn-outside-tests': 'error',
      'openwaggle/prefer-inferred-internal-return-types': 'error',
      'openwaggle/jsx-max-props': ['error', { maximum: 8 }],
      'openwaggle/renderer-import-boundaries': 'error',
      'openwaggle/test-colocation': 'error',
      'ts-match/prefer-match-over-switch': 'error',
      'ts-match/prefer-match-over-else-if': 'error',
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/no-rest-destructuring': 'error',
      '@tanstack/query/stable-query-client': 'error',
      '@tanstack/query/no-unstable-deps': 'error',
      '@tanstack/query/infinite-query-property-order': 'error',
      '@tanstack/query/no-void-query-fn': 'error',
      '@tanstack/query/mutation-property-order': 'error',
      '@tanstack/query/prefer-query-options': 'error',
      '@tanstack/router/create-route-property-order': 'error',
      '@tanstack/router/route-param-names': 'error',
    },
  },
  {
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    rules: {
      'openwaggle/renderer-design-token-guardrails': [
        'error',
        { exemptFiles: readRendererDesignTokenExemptions() },
      ],
    },
  },
  {
    files: [
      'src/**/*.test.{ts,tsx}',
      'src/**/__tests__/**/*.{ts,tsx}',
      'packages/**/*.test.ts',
      'packages/**/__tests__/**/*.ts',
      'scripts/**/*.test.ts',
      'website/**/*.test.{ts,tsx}',
      'website/**/__tests__/**/*.{ts,tsx}',
    ],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: false }],
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['src/renderer/src/**/hooks/**/*.{ts,tsx}'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['website/src/**/*.astro'],
    plugins: {
      openwaggle: openwagglePlugin,
    },
    processor: 'openwaggle/astro-template',
  },
]

export default config
