import type { Node, Rule } from '@oxlint/plugins'
import { sourceValueOf } from '../ast-helpers.ts'
import { isRendererImportAllowed } from '../renderer-import-boundaries.ts'

export const rendererImportBoundariesRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      invalidBoundary:
        'Invalid renderer import boundary. Use shared infrastructure or a feature public index; do not import legacy roots or another feature internals.',
    },
  },
  create(context) {
    function checkImport(node: Node) {
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
