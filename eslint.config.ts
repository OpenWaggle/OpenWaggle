import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import tanstackQueryPlugin from '@tanstack/eslint-plugin-query'
import tanstackRouterPlugin from '@tanstack/eslint-plugin-router'
import importPlugin from 'eslint-plugin-import'
import eslintComments from 'eslint-plugin-eslint-comments'
import tseslint, { type Config } from 'typescript-eslint'
import { openwagglePlugin } from './scripts/eslint/openwaggle-plugin'
import { tsMatchPlugin } from './scripts/eslint/ts-match-plugin'

const ROOT_DIR = dirname(fileURLToPath(import.meta.url))

const config: Config = [
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      'website/.astro/**',
      'website/dist/**',
      'website/node_modules/**',
      'src/renderer/src/env.d.ts',
      'src/renderer/src/routeTree.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        project: './tsconfig.eslint.json',
        sourceType: 'module',
        tsconfigRootDir: ROOT_DIR,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'eslint-comments': eslintComments,
      import: importPlugin,
      openwaggle: openwagglePlugin,
      'ts-match': tsMatchPlugin,
      '@tanstack/query': tanstackQueryPlugin,
      '@tanstack/router': tanstackRouterPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.node.json', './tsconfig.web.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      complexity: ['error', { max: 15 }],
      'import/no-cycle': ['error', { ignoreExternal: true }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: false }],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: false }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-undef': 'off',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'eslint-comments/no-use': 'error',
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
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: false }],
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['website/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['src/renderer/src/shared/lib/ipc.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
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
