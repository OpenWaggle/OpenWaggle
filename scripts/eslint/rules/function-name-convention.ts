import type { Rule } from 'eslint'
import { hasNodeType, property } from '../ast-helpers'

const MAX_FUNCTION_NAME_LENGTH = 55
const FUNCTION_NAME_PATTERN = /^\$*(?:[a-z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*)$/

function identifierName(value: unknown) {
  const name = property(value, 'name')
  return typeof name === 'string' ? name : null
}

function reportInvalidName(node: Rule.Node, context: Rule.RuleContext) {
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

export const functionNameConventionRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    messages: {
      invalidFunctionName:
        'Function names must use camelCase or PascalCase and contain at most 55 characters.',
    },
  },
  create(context) {
    return {
      FunctionDeclaration(node: Rule.Node) {
        reportInvalidName(node, context)
      },
      FunctionExpression(node: Rule.Node) {
        reportInvalidName(node, context)
      },
      VariableDeclarator(node: Rule.Node) {
        if (!isFunctionValue(property(node, 'init'))) {
          return
        }

        reportInvalidName(node, context)
      },
    }
  },
}
