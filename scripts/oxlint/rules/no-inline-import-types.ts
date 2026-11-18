import type { Node, Rule } from '@oxlint/plugins'
import { isTestFilename, normalizedFilename } from '../ast-helpers.ts'

export const noInlineImportTypesRule: Rule = {
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
      TSImportType(node: Node) {
        context.report({
          node,
          messageId: 'inlineImportType',
        })
      },
    }
  },
}
