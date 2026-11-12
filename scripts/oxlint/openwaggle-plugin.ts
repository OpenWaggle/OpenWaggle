import type { Plugin } from '@oxlint/plugins'
import { desktopShellBoundaryRule } from './rules/desktop-shell-boundary.ts'
import { functionNameConventionRule } from './rules/function-name-convention.ts'
import { jsxMaxPropsRule } from './rules/jsx-max-props.ts'
import { mainArchitectureBoundariesRule } from './rules/main-architecture-boundaries.ts'
import { noApiTypeofGuardRule } from './rules/no-api-typeof-guard.ts'
import { noArchitectureIgnoreCommentsRule } from './rules/no-architecture-ignore-comments.ts'
import { noForEachRule } from './rules/no-for-each.ts'
import { noInlineImportTypesRule } from './rules/no-inline-import-types.ts'
import { noInlineMagicNumbersRule } from './rules/no-inline-magic-numbers.ts'
import { noInfiniteForLoopRule } from './rules/no-infinite-for-loop.ts'
import { noLintDirectiveCommentsRule } from './rules/no-lint-directive-comments.ts'
import { noLiteralKeyLookupRule } from './rules/no-literal-key-lookup.ts'
import { noOptionalUndefinedRule } from './rules/no-optional-undefined.ts'
import { noRawRendererButtonsRule } from './rules/no-raw-renderer-buttons.ts'
import { noReactLegacyPatternsRule } from './rules/no-react-legacy-patterns.ts'
import { noShoehornOutsideTestsRule } from './rules/no-shoehorn-outside-tests.ts'
import { noUncaughtVoidIpcRule } from './rules/no-uncaught-void-ipc.ts'
import { preferInferredInternalReturnTypesRule } from './rules/prefer-inferred-internal-return-types.ts'
import { rendererImportBoundariesRule } from './rules/renderer-import-boundaries-rule.ts'
import { rendererDesignTokenGuardrailsRule } from './rules/renderer-design-token-guardrails.ts'
import { testColocationRule } from './rules/test-colocation.ts'

export const openwagglePlugin: Plugin = {
  meta: {
    name: 'openwaggle',
  },
  rules: {
    'desktop-shell-boundary': desktopShellBoundaryRule,
    'function-name-convention': functionNameConventionRule,
    'jsx-max-props': jsxMaxPropsRule,
    'main-architecture-boundaries': mainArchitectureBoundariesRule,
    'no-api-typeof-guard': noApiTypeofGuardRule,
    'no-architecture-ignore-comments': noArchitectureIgnoreCommentsRule,
    'no-for-each': noForEachRule,
    'no-inline-import-types': noInlineImportTypesRule,
    'no-lint-directive-comments': noLintDirectiveCommentsRule,
    'no-inline-magic-numbers': noInlineMagicNumbersRule,
    'no-literal-key-lookup': noLiteralKeyLookupRule,
    'no-optional-undefined': noOptionalUndefinedRule,
    'no-infinite-for-loop': noInfiniteForLoopRule,
    'no-raw-renderer-buttons': noRawRendererButtonsRule,
    'no-react-legacy-patterns': noReactLegacyPatternsRule,
    'no-shoehorn-outside-tests': noShoehornOutsideTestsRule,
    'no-uncaught-void-ipc': noUncaughtVoidIpcRule,
    'prefer-inferred-internal-return-types': preferInferredInternalReturnTypesRule,
    'renderer-import-boundaries': rendererImportBoundariesRule,
    'renderer-design-token-guardrails': rendererDesignTokenGuardrailsRule,
    'test-colocation': testColocationRule,
  },
}

export default openwagglePlugin
