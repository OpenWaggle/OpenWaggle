import type { Rule } from 'eslint'
import { property } from '../ast-helpers'

function isMissing(value: unknown) {
  return value === null || value === undefined
}

export const noInfiniteForLoopRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      noInfiniteForLoop:
        'Do not use `for (;;)` loops. Use an explicit loop condition or a named helper so termination is reviewable.',
    },
  },
  create(context) {
    return {
      ForStatement(node: Rule.Node) {
        if (
          isMissing(property(node, 'init')) &&
          isMissing(property(node, 'test')) &&
          isMissing(property(node, 'update'))
        ) {
          context.report({
            node,
            messageId: 'noInfiniteForLoop',
          })
        }
      },
    }
  },
}
