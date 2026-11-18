import type { Rule } from '@oxlint/plugins'

export const noInfiniteForLoopRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      noInfiniteForLoop:
        'Do not use `for (;;)` loops. Use an explicit loop condition or a named helper so termination is reviewable.',
    },
  },
  create(context) {
    return {
      ForStatement(node) {
        if (node.init === null && node.test === null && node.update === null) {
          context.report({
            node,
            messageId: 'noInfiniteForLoop',
          })
        }
      },
    }
  },
}
