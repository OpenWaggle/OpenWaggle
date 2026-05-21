import type { Rule } from 'eslint'

const FORBIDDEN_IGNORE_MARKERS = [
  'eslint-disable',
  'biome-ignore',
  'fallow-ignore',
  'SAFETY:',
]

export const noArchitectureIgnoreCommentsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      forbiddenIgnore:
        'Architecture enforcement must not be bypassed with eslint-disable, biome-ignore, fallow-ignore, or SAFETY comments.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (!comment.loc) {
            continue
          }

          if (FORBIDDEN_IGNORE_MARKERS.some((marker) => comment.value.includes(marker))) {
            context.report({
              loc: comment.loc,
              messageId: 'forbiddenIgnore',
            })
          }
        }
      },
    }
  },
}
