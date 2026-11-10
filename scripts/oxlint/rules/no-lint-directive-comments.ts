import type { Rule } from '@oxlint/plugins'

// Ports eslint-comments/no-use: a finding is fixed in code or in the shared lint config, never
// with an inline directive. Covers the ESLint directives bun lint and oxlint honor plus oxlint's
// own `oxlint-*` spellings. Line comments only carry the disable-line/next-line forms.
const LINE_DIRECTIVE_PATTERN = /^(?:eslint|oxlint)-disable(?:-next-line|-line)?(?:\s|$)/
const BLOCK_DIRECTIVE_PATTERN =
  /^(?:(?:eslint|oxlint)(?:-disable|-enable|-env)?|globals?|exported)(?:\s|$)/

function isLintDirective(type: string, value: string) {
  const text = value.trimStart()
  return type === 'Line' ? LINE_DIRECTIVE_PATTERN.test(text) : BLOCK_DIRECTIVE_PATTERN.test(text)
}

export const noLintDirectiveCommentsRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      forbiddenDirective:
        'Lint directive comments are not allowed; fix the code or change the shared lint config.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isLintDirective(comment.type, comment.value)) {
            context.report({ loc: comment.loc, messageId: 'forbiddenDirective' })
          }
        }
      },
    }
  },
}
