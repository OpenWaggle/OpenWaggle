import type { Rule } from 'eslint'
import { isTestFilename, normalizedFilename } from '../ast-helpers'

export const noInlineImportTypesRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      inlineImportType:
        'Inline import() types are disallowed; import named types at the top of the file.',
    },
  },
  create(context) {
    const filename = normalizedFilename(context.filename)
    if (filename.endsWith('.d.ts') || isTestFilename(filename)) {
      return {}
    }

    return {
      TSImportType(node: Rule.Node) {
        context.report({
          node,
          messageId: 'inlineImportType',
        })
      },
    }
  },
}
