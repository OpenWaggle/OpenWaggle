import type { ESLint } from 'eslint'
import { astroTemplateProcessor } from './processors/astro-template'
import { jsxMaxPropsRule } from './rules/jsx-max-props'
import { mainArchitectureBoundariesRule } from './rules/main-architecture-boundaries'
import { noArchitectureIgnoreCommentsRule } from './rules/no-architecture-ignore-comments'
import { noInlineImportTypesRule } from './rules/no-inline-import-types'
import { noInlineMagicNumbersRule } from './rules/no-inline-magic-numbers'
import { noInfiniteForLoopRule } from './rules/no-infinite-for-loop'
import { noRawRendererButtonsRule } from './rules/no-raw-renderer-buttons'
import { noReactLegacyPatternsRule } from './rules/no-react-legacy-patterns'
import { noShoehornOutsideTestsRule } from './rules/no-shoehorn-outside-tests'
import { preferInferredInternalReturnTypesRule } from './rules/prefer-inferred-internal-return-types'
import { rendererImportBoundariesRule } from './rules/renderer-import-boundaries-rule'
import { testColocationRule } from './rules/test-colocation'

export const openwagglePlugin: ESLint.Plugin = {
  meta: {
    name: 'openwaggle',
  },
  processors: {
    'astro-template': astroTemplateProcessor,
  },
  rules: {
    'jsx-max-props': jsxMaxPropsRule,
    'main-architecture-boundaries': mainArchitectureBoundariesRule,
    'no-architecture-ignore-comments': noArchitectureIgnoreCommentsRule,
    'no-inline-import-types': noInlineImportTypesRule,
    'no-inline-magic-numbers': noInlineMagicNumbersRule,
    'no-infinite-for-loop': noInfiniteForLoopRule,
    'no-raw-renderer-buttons': noRawRendererButtonsRule,
    'no-react-legacy-patterns': noReactLegacyPatternsRule,
    'no-shoehorn-outside-tests': noShoehornOutsideTestsRule,
    'prefer-inferred-internal-return-types': preferInferredInternalReturnTypesRule,
    'renderer-import-boundaries': rendererImportBoundariesRule,
    'test-colocation': testColocationRule,
  },
}
