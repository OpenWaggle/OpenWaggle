import type { Context, ESTree, Rule } from '@oxlint/plugins'

const MAX_FUNCTION_NAME_LENGTH = 55
const FUNCTION_NAME_PATTERN = /^\$*(?:[a-z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*)$/

/** The name a function or declarator binds; a destructuring pattern binds no single name. */
function boundName(node: ESTree.Function | ESTree.VariableDeclarator) {
  return node.id?.type === 'Identifier' ? node.id.name : null
}

function reportInvalidName(node: ESTree.Function | ESTree.VariableDeclarator, context: Context) {
  const name = boundName(node)
  if (
    name === null ||
    (name.length <= MAX_FUNCTION_NAME_LENGTH && FUNCTION_NAME_PATTERN.test(name))
  ) {
    return
  }

  context.report({ node, messageId: 'invalidFunctionName' })
}

function isFunctionValue(value: ESTree.Expression | null) {
  return value?.type === 'ArrowFunctionExpression' || value?.type === 'FunctionExpression'
}

export const functionNameConventionRule: Rule = {
  meta: {
    type: 'suggestion',
    messages: {
      invalidFunctionName:
        'Function names must use camelCase or PascalCase and contain at most 55 characters.',
    },
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        reportInvalidName(node, context)
      },
      FunctionExpression(node) {
        reportInvalidName(node, context)
      },
      VariableDeclarator(node) {
        if (!isFunctionValue(node.init)) {
          return
        }

        reportInvalidName(node, context)
      },
    }
  },
}
