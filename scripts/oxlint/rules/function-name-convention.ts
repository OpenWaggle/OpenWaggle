import type { Context, Node, Rule } from '@oxlint/plugins'
import { hasNodeType, property } from '../ast-helpers.ts'

const MAX_FUNCTION_NAME_LENGTH = 55
const FUNCTION_NAME_PATTERN = /^\$*(?:[a-z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*)$/

function identifierName(value: unknown) {
  const name = property(value, 'name')
  return typeof name === 'string' ? name : null
}

function reportInvalidName(node: Node, context: Context) {
  const name = identifierName(property(node, 'id'))
  if (
    name === null ||
    (name.length <= MAX_FUNCTION_NAME_LENGTH && FUNCTION_NAME_PATTERN.test(name))
  ) {
    return
  }

  context.report({ node, messageId: 'invalidFunctionName' })
}

function isFunctionValue(value: unknown) {
  return hasNodeType(value, 'ArrowFunctionExpression') || hasNodeType(value, 'FunctionExpression')
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
      FunctionDeclaration(node: Node) {
        reportInvalidName(node, context)
      },
      FunctionExpression(node: Node) {
        reportInvalidName(node, context)
      },
      VariableDeclarator(node: Node) {
        if (!isFunctionValue(property(node, 'init'))) {
          return
        }

        reportInvalidName(node, context)
      },
    }
  },
}
