import type { Rule } from 'eslint'
import { sourceValueOf } from '../ast-helpers'
import { isRendererImportAllowed } from '../renderer-import-boundaries'

export const rendererImportBoundariesRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      invalidBoundary:
        'Invalid renderer import boundary. Use shared infrastructure or a feature public index; do not import legacy roots or another feature internals.',
    },
  },
  create(context) {
    function checkImport(node: Rule.Node) {
      const importPath = sourceValueOf(node)
      if (!importPath || isRendererImportAllowed(importPath, context.filename)) {
        return
      }

      context.report({
        node,
        messageId: 'invalidBoundary',
      })
    }

    return {
      ExportAllDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
      ImportDeclaration: checkImport,
    }
  },
}
