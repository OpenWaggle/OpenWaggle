import type { Rule } from 'eslint'
import { isTestFilename, sourceValueOf } from '../ast-helpers'

const SHOEHORN_PACKAGE = '@total-typescript/shoehorn'

function isShoehornImport(importPath: string) {
  return importPath === SHOEHORN_PACKAGE || importPath.startsWith(`${SHOEHORN_PACKAGE}/`)
}

export const noShoehornOutsideTestsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      noShoehornOutsideTests:
        'Shoehorn is a sanctioned test-only escape hatch. Do not import @total-typescript/shoehorn outside tests.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node: Rule.Node) {
        const importPath = sourceValueOf(node)
        if (!importPath || !isShoehornImport(importPath) || isTestFilename(context.filename)) {
          return
        }

        context.report({
          node,
          messageId: 'noShoehornOutsideTests',
        })
      },
    }
  },
}
