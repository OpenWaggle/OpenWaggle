import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { type DummyRuleMap, defineConfig } from 'oxlint'

/*
 * One lint config for the repository, read by `bun lint` (a pinned Bun canary, see package.json)
 * and by oxlint, the fallback runner. It reproduces the rules the earlier tools enforced, each on
 * the files that tool covered:
 *
 * - TYPE_AWARE_RULES: the former oxlint config (src, packages, scripts, website, functions).
 * - ESLINT_RULES: ESLint's recommended rules plus the project's ESLint rules and plugins, on the
 *   TypeScript files ESLint linted.
 * - BIOME_RULES: the Biome rules that failed `biome check` (recommended error-level rules, the
 *   React and test domains, and biome.json's explicit rules) on src, packages, fixtures and
 *   functions. Biome's warning- and info-level rules never failed the gate and are not carried.
 *
 * Inline suppressions are banned (openwaggle/no-lint-directive-comments); a finding is fixed in
 * code or here.
 *
 * Not carried, because the oxlint rule reports code the earlier rule accepted and has no option
 * to match it (Biome had zero findings in each case; a later strictness pass decides):
 * - Biome noForEach -> openwaggle/no-for-each (a port), not unicorn/no-array-for-each, which also
 *   reports callbacks that use the index and Effect.forEach.
 * - Biome useSemanticElements (jsx-a11y/prefer-tag-over-role reports more roles),
 *   noAutofocus, useFocusableInteractive, noNoninteractiveTabindex, useButtonType (dynamic
 *   `type`), noArrayIndexKey (`String(index)`), useExhaustiveDependencies (react/exhaustive-deps
 *   wants the whole object for `options.callback`), noInvalidBuiltinInstantiation
 *   (unicorn/new-for-builtins also wants `new Object()`; TypeScript rejects calling Map/Set/...
 *   without `new`), noRedeclare (reports a type and a value sharing a name), and noScriptUrl
 *   outside JSX (react/jsx-no-script-url covers JSX).
 * - Biome rules with no oxlint equivalent: noConstantMathMinMaxClamp, noStringCaseMismatch,
 *   noMisrefactoredShorthandAssign, noSvgWithoutTitle, noImplicitAnyLet, noVoidTypeReturn.
 * - Biome's warning/info rules, its CSS rules, and its organizeImports assist (oxfmt's import
 *   sorter orders differently and would reorder module evaluation in about 170 files).
 * - ESLint import-x/no-cycle never resolved `.ts` files here, so it reported nothing; oxlint's
 *   import/no-cycle finds 126 real cycles and stays off until they are untangled.
 */

// Read as JSON so neither runner has to load a TypeScript module to build the config;
// check:repository-standards validates the file (sorted, unique, existing paths).
function readRendererDesignTokenExemptions() {
  const parsed: unknown = JSON.parse(
    readFileSync(
      new URL('./scripts/renderer-design-token-exemptions.json', import.meta.url),
      'utf8',
    ),
  )
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('scripts/renderer-design-token-exemptions.json must be an array of paths')
  }
  return parsed
}

const TYPE_AWARE_FILES = [
  'src/**',
  'packages/**',
  'scripts/**',
  'website/**',
  'functions/**',
  'electron.vite.config.ts',
]

const ESLINT_FILES = [
  'src/**/*.{ts,tsx}',
  'packages/**/*.ts',
  'scripts/**/*.ts',
  'functions/**/*.ts',
  'website/**/*.{ts,tsx}',
  'electron.vite.config.ts',
]

const BIOME_FILES = ['src/**', 'packages/**', 'fixtures/**', 'functions/**']

const TEST_FILES = [
  'src/**/*.test.{ts,tsx}',
  'src/**/__tests__/**/*.{ts,tsx}',
  'packages/**/*.test.{ts,tsx}',
  'packages/**/__tests__/**/*.{ts,tsx}',
  'scripts/**/*.test.ts',
  'functions/**/__tests__/**/*.ts',
  'website/**/*.test.{ts,tsx}',
  'website/**/__tests__/**/*.{ts,tsx}',
]

const MAX_LINES: DummyRuleMap = {
  'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: false }],
}

const UNSAFE_TYPE_RULES_OFF: DummyRuleMap = {
  'typescript/no-unsafe-argument': 'off',
  'typescript/no-unsafe-assignment': 'off',
  'typescript/no-unsafe-call': 'off',
  'typescript/no-unsafe-member-access': 'off',
  'typescript/no-unsafe-return': 'off',
}

const TYPE_AWARE_RULES: DummyRuleMap = {
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
  'typescript/no-wrapper-object-types': 'error',
  'typescript/prefer-as-const': 'error',
  'typescript/prefer-namespace-keyword': 'error',
  'typescript/triple-slash-reference': 'error',
}

const ESLINT_RULES: DummyRuleMap = {
  // ESLint's recommended rules that still applied to TypeScript files.
  'for-direction': 'error',
  'no-async-promise-executor': 'error',
  'no-case-declarations': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-constant-binary-expression': 'error',
  'no-constant-condition': ['error', { checkLoops: 'allExceptWhileTrue' }],
  'no-control-regex': 'error',
  'no-debugger': 'error',
  'no-delete-var': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-empty-character-class': 'error',
  'no-empty-pattern': 'error',
  'no-empty-static-block': 'error',
  'no-ex-assign': 'error',
  'no-extra-boolean-cast': 'error',
  'no-fallthrough': 'error',
  'no-global-assign': 'error',
  'no-invalid-regexp': 'error',
  'no-irregular-whitespace': 'error',
  'no-loss-of-precision': 'error',
  'no-misleading-character-class': 'error',
  'no-nonoctal-decimal-escape': 'error',
  'no-prototype-builtins': 'error',
  'no-regex-spaces': 'error',
  'no-self-assign': ['error', { props: true }],
  'no-shadow-restricted-names': ['error', { reportGlobalThis: true }],
  'no-sparse-arrays': 'error',
  'no-unassigned-vars': 'error',
  'no-unexpected-multiline': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unused-labels': 'error',
  'no-unused-private-class-members': 'error',
  'no-useless-assignment': 'error',
  'no-useless-backreference': 'error',
  'no-useless-catch': 'error',
  'no-useless-escape': 'error',
  'preserve-caught-error': 'error',
  'require-yield': 'error',
  'use-isnan': ['error', { enforceForSwitchCase: true, enforceForIndexOf: false }],
  'valid-typeof': 'error',
  // The project's own ESLint rules.
  complexity: ['error', { max: 15 }],
  ...MAX_LINES,
  'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: false }],
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'any', ignoreReadBeforeAssign: false }],
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
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
}

const BIOME_RULES: DummyRuleMap = {
  // a11y
  'jsx-a11y/alt-text': 'error',
  'jsx-a11y/anchor-ambiguous-text': 'error',
  'jsx-a11y/anchor-has-content': 'error',
  'jsx-a11y/anchor-is-valid': 'error',
  'jsx-a11y/aria-activedescendant-has-tabindex': 'error',
  'jsx-a11y/aria-props': 'error',
  'jsx-a11y/aria-proptypes': 'error',
  'jsx-a11y/aria-role': 'error',
  'jsx-a11y/aria-unsupported-elements': 'error',
  'jsx-a11y/autocomplete-valid': 'error',
  'jsx-a11y/click-events-have-key-events': 'error',
  'jsx-a11y/heading-has-content': 'error',
  'jsx-a11y/html-has-lang': 'error',
  'jsx-a11y/iframe-has-title': 'error',
  'jsx-a11y/img-redundant-alt': 'error',
  'jsx-a11y/label-has-associated-control': 'error',
  'jsx-a11y/lang': 'error',
  'jsx-a11y/media-has-caption': 'error',
  'jsx-a11y/mouse-events-have-key-events': 'error',
  'jsx-a11y/no-access-key': 'error',
  'jsx-a11y/no-aria-hidden-on-focusable': 'error',
  'jsx-a11y/no-distracting-elements': 'error',
  'jsx-a11y/no-interactive-element-to-noninteractive-role': 'error',
  'jsx-a11y/no-noninteractive-element-to-interactive-role': 'error',
  'jsx-a11y/no-redundant-roles': 'error',
  'jsx-a11y/no-static-element-interactions': 'error',
  'jsx-a11y/role-has-required-aria-props': 'error',
  'jsx-a11y/role-supports-aria-props': 'error',
  'jsx-a11y/scope': 'error',
  'jsx-a11y/tabindex-no-positive': 'error',
  // React (Biome's React domain is on because package.json lists react)
  'react/jsx-key': 'error',
  'react/jsx-no-comment-textnodes': 'error',
  'react/jsx-no-duplicate-props': 'error',
  'react/jsx-no-script-url': 'error',
  'react/jsx-no-target-blank': 'error',
  'react/no-children-prop': 'error',
  'react/no-danger': 'error',
  'react/no-danger-with-children': 'error',
  'react/no-render-return-value': 'error',
  'react/rules-of-hooks': 'error',
  'react/void-dom-elements-no-children': 'error',
  // Tests (Biome's test domain is on because package.json lists vitest)
  'jest/no-duplicate-hooks': 'error',
  'jest/no-export': 'error',
  // JavaScript and TypeScript
  'array-callback-return': ['error', { checkForEach: true, allowVoid: true }],
  'constructor-super': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'for-direction': 'error',
  'getter-return': 'error',
  'no-async-promise-executor': 'error',
  'no-case-declarations': 'error',
  'no-class-assign': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': ['error', 'always'],
  'no-const-assign': 'error',
  'no-constant-condition': 'error',
  'no-constructor-return': 'error',
  'no-control-regex': 'error',
  'no-debugger': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-empty-character-class': 'error',
  'no-empty-pattern': 'error',
  'no-eval': 'error',
  'no-fallthrough': 'error',
  'no-func-assign': 'error',
  'no-global-assign': 'error',
  'no-import-assign': 'error',
  'no-inner-declarations': 'error',
  'no-label-var': 'error',
  'no-loss-of-precision': 'error',
  'no-misleading-character-class': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-nonoctal-decimal-escape': 'error',
  'no-obj-calls': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-setter-return': 'error',
  'no-shadow-restricted-names': 'error',
  'no-sparse-arrays': 'error',
  'no-this-before-super': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unused-vars': 'error',
  'no-use-before-define': [
    'error',
    {
      functions: false,
      classes: false,
      variables: false,
      typedefs: false,
      ignoreTypeReferences: true,
    },
  ],
  'no-with': 'error',
  'prefer-const': 'error',
  'require-yield': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'node/no-process-env': 'error',
  'typescript/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
  'typescript/no-empty-interface': 'error',
  'typescript/no-explicit-any': 'error',
  'typescript/no-misused-new': 'error',
  'typescript/no-non-null-asserted-optional-chain': 'error',
  'typescript/no-non-null-assertion': 'error',
  'typescript/no-unsafe-declaration-merging': 'error',
  'typescript/prefer-namespace-keyword': 'error',
  'unicorn/no-thenable': 'error',
  'openwaggle/no-for-each': 'error',
}

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'react', 'jsx-a11y', 'node', 'jest'],
  jsPlugins: [
    { name: 'openwaggle', specifier: './scripts/oxlint/openwaggle-plugin.ts' },
    { name: 'ts-match', specifier: './scripts/oxlint/ts-match-plugin.ts' },
    { name: '@tanstack/query', specifier: '@tanstack/eslint-plugin-query' },
    { name: '@tanstack/router', specifier: '@tanstack/eslint-plugin-router' },
  ],
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
    denyWarnings: true,
    reportUnusedDisableDirectives: 'error',
  },
  rules: {
    'openwaggle/no-lint-directive-comments': 'error',
  },
  overrides: [
    { files: TYPE_AWARE_FILES, rules: TYPE_AWARE_RULES },
    { files: BIOME_FILES, rules: BIOME_RULES },
    { files: ESLINT_FILES, rules: ESLINT_RULES },
    // Where Biome and ESLint both applied, Biome's noAssignInExpressions was the stricter one.
    { files: BIOME_FILES, rules: { 'no-cond-assign': ['error', 'always'] } },
    {
      files: ['src/renderer/src/**/*.{ts,tsx}'],
      rules: {
        'openwaggle/no-uncaught-void-ipc': 'error',
        'openwaggle/renderer-design-token-guardrails': [
          'error',
          { exemptFiles: readRendererDesignTokenExemptions() },
        ],
      },
    },
    {
      files: TEST_FILES,
      rules: { ...UNSAFE_TYPE_RULES_OFF, ...MAX_LINES, 'max-lines-per-function': 'off' },
    },
    { files: ['website/**/*.{ts,tsx}'], rules: UNSAFE_TYPE_RULES_OFF },
    {
      files: ['src/renderer/src/shared/lib/ipc.ts'],
      rules: {
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-return': 'off',
      },
    },
    {
      // Cloudflare Pages Functions run in the Workers runtime, which has no Node built-ins
      // without the nodejs_compat flag. Keep the deployed bundle on web-standard APIs: neither
      // `node:` imports nor bare built-in names such as `crypto` or `fs/promises`.
      files: ['functions/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: builtinModules.map((name) => ({
              name,
              message: 'Pages Functions run without Node built-ins; use a web-standard API.',
            })),
            patterns: ['node:*'],
          },
        ],
        'no-restricted-globals': [
          'error',
          'process',
          'Buffer',
          'require',
          '__dirname',
          '__filename',
        ],
      },
    },
    {
      // Function tests run in Node; the Workers restrictions cover the deployed code only.
      files: ['functions/**/__tests__/**'],
      rules: { 'no-restricted-imports': 'off', 'no-restricted-globals': 'off' },
    },
    {
      // Generated by scripts/generate-usage-statistics-catalog.ts: one line per catalog
      // identifier, so its length follows Pi's model catalog. Every other rule still applies.
      files: ['src/shared/usage-statistics/catalog.generated.ts'],
      rules: { 'max-lines': 'off' },
    },
    {
      files: ['src/renderer/src/**/hooks/**/*.{ts,tsx}'],
      rules: { 'max-lines-per-function': 'off' },
    },
    {
      // The Effect DI composition root wires every service layer plus the bundled
      // provider/OAuth registrations; it legitimately runs a little over the default.
      files: ['src/main/runtime.ts'],
      rules: { 'max-lines': ['error', { max: 340, skipBlankLines: true, skipComments: false }] },
    },
    {
      // QA seed and website screenshot fixtures: fixture data, not production code.
      files: ['scripts/support/**/*.ts'],
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        complexity: 'off',
        'openwaggle/no-inline-magic-numbers': 'off',
        'openwaggle/prefer-inferred-internal-return-types': 'off',
      },
    },
    {
      // These files passed the size limits before the repository was first formatted with oxfmt,
      // which split their long one-line tables and calls. Split them, then drop them from here.
      files: [
        'scripts/__tests__/app-release-train.integration.test.ts',
        'scripts/__tests__/check-conventional-commits.unit.test.ts',
        'scripts/__tests__/package-release-lines.unit.test.ts',
        'scripts/benchmark-docker/__tests__/benchmark-proxy.integration.test.ts',
        'scripts/native-binary-formats.ts',
        'scripts/package-release-promote.ts',
        'scripts/package-release-validator-ci.ts',
        'scripts/package-release-validator-pipeline.ts',
        'scripts/package-release-validator.ts',
        'scripts/qa/packaged-session-host-startup-smoke.ts',
        'scripts/rebuild-native-deps.ts',
        'src/main/ipc/git/__tests__/managed-worktree-push.integration.test.ts',
        'src/main/ipc/git/__tests__/push-destination.integration.test.ts',
        'src/shared/types/openwaggle-api.ts',
      ],
      rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
    },
    {
      // oxlint false positive: AggregateError([error, cleanupError], ...) keeps the caught error,
      // which ESLint's preserve-caught-error accepted.
      files: ['src/main/session-host/local-session-paths.ts'],
      rules: { 'preserve-caught-error': 'off' },
    },
    {
      // oxlint false positive: a do...while whose body ends in `throw` after branches that
      // `continue`; the loop condition is reachable. Biome's noUnreachable accepted it.
      files: ['src/main/adapters/__tests__/sqlite-session-query-transcript-test-support.ts'],
      rules: { 'no-unreachable': 'off' },
    },
    {
      files: ['src/main/env.ts', 'src/main/boot.ts'],
      rules: { 'node/no-process-env': 'off' },
    },
  ],
})
