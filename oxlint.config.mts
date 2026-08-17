import { defineConfig } from 'oxlint'

const TEST_FILES = [
  'src/**/*.test.{ts,tsx}',
  'src/**/__tests__/**/*.{ts,tsx}',
  'packages/**/*.test.ts',
  'packages/**/__tests__/**/*.ts',
  'scripts/**/*.test.ts',
  'website/**/*.test.{ts,tsx}',
  'website/**/__tests__/**/*.{ts,tsx}',
]

const UNSAFE_TYPE_RULES_OFF = {
  'typescript/no-unsafe-argument': 'off',
  'typescript/no-unsafe-assignment': 'off',
  'typescript/no-unsafe-call': 'off',
  'typescript/no-unsafe-member-access': 'off',
  'typescript/no-unsafe-return': 'off',
} as const

export default defineConfig({
  categories: {
    correctness: 'off',
  },
  ignorePatterns: [
    'dist/**',
    'out/**',
    'node_modules/**',
    'packages/**/.pack/**',
    'packages/**/dist/**',
    'packages/**/dist-cjs/**',
    'website/.astro/**',
    'website/dist/**',
    'website/node_modules/**',
    'website/**/*.astro',
    'src/renderer/src/env.d.ts',
    'src/renderer/src/routeTree.gen.ts',
  ],
  options: {
    typeAware: true,
  },
  plugins: ['typescript'],
  rules: {
    'typescript/ban-ts-comment': 'error',
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'typescript/no-array-constructor': 'error',
    'typescript/no-deprecated': 'error',
    'typescript/no-duplicate-enum-values': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-extra-non-null-assertion': 'error',
    'typescript/no-misused-new': 'error',
    'typescript/no-namespace': 'error',
    'typescript/no-non-null-asserted-optional-chain': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/no-this-alias': 'error',
    'typescript/no-unnecessary-type-assertion': 'error',
    'typescript/no-unnecessary-type-constraint': 'error',
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-unsafe-assignment': 'error',
    'typescript/no-unsafe-call': 'error',
    'typescript/no-unsafe-declaration-merging': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-unsafe-member-access': 'error',
    'typescript/no-unsafe-return': 'error',
    'typescript/no-unsafe-type-assertion': 'error',
    'typescript/no-unused-expressions': 'error',
    'typescript/no-unused-vars': 'off',
    'typescript/no-wrapper-object-types': 'error',
    'typescript/prefer-as-const': 'error',
    'typescript/prefer-namespace-keyword': 'error',
    'typescript/triple-slash-reference': 'error',
  },
  overrides: [
    {
      files: TEST_FILES,
      rules: UNSAFE_TYPE_RULES_OFF,
    },
    {
      files: ['website/**/*.{ts,tsx}'],
      rules: UNSAFE_TYPE_RULES_OFF,
    },
    {
      files: ['src/renderer/src/shared/lib/ipc.ts'],
      rules: {
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-return': 'off',
      },
    },
  ],
})
