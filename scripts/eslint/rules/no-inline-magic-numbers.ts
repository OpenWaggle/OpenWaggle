import type { Rule } from 'eslint'
import { isTestFilename, nodeType, parentOf, property } from '../ast-helpers'

const NEGATIVE_ONE_LITERAL = '-1'
const NEGATIVE_ZERO_LITERAL = '-0'
const ONE_LITERAL = '1'
const ZERO_LITERAL = '0'
const DISALLOWED_EXTRACTION_COMMENT = 'Extracted from inlined numeric' + ' literal'

function literalRaw(node: Rule.Node) {
  const raw = property(node, 'raw')
  return typeof raw === 'string' ? raw : null
}

function literalValue(node: Rule.Node) {
  return property(node, 'value')
}

function isNumericLiteral(node: Rule.Node) {
  return nodeType(node) === 'Literal' && typeof literalValue(node) === 'number'
}

function isUnaryNegativeNumericLiteral(node: Rule.Node) {
  return (
    nodeType(node) === 'UnaryExpression' &&
    property(node, 'operator') === '-' &&
    isNumericLiteralArgument(property(node, 'argument'))
  )
}

function isNumericLiteralArgument(value: unknown): value is Rule.Node {
  return nodeType(value) === 'Literal' && typeof property(value, 'value') === 'number'
}

function shouldIgnoreLiteralValue(literalText: string) {
  return (
    literalText === ZERO_LITERAL ||
    literalText === ONE_LITERAL ||
    literalText === NEGATIVE_ZERO_LITERAL ||
    literalText === NEGATIVE_ONE_LITERAL
  )
}

function isScreamingSnakeCase(name: string) {
  return /^[A-Z][A-Z0-9_]*$/.test(name)
}

function isInTypePosition(node: Rule.Node) {
  let current = parentOf(node)

  while (current) {
    const type = nodeType(current)
    if (type?.startsWith('TS')) {
      return true
    }
    current = parentOf(current)
  }

  return false
}

function isInEnumDeclaration(node: Rule.Node) {
  let current = parentOf(node)

  while (current) {
    if (nodeType(current) === 'TSEnumDeclaration') {
      return true
    }
    current = parentOf(current)
  }

  return false
}

function isWithinNamedConstantInitializer(node: Rule.Node) {
  let current: unknown = node

  while (current) {
    const parent = parentOf(current)
    if (!parent) {
      return false
    }

    if (nodeType(parent) === 'VariableDeclarator' && property(parent, 'init') === current) {
      const declaration = parentOf(parent)
      const name = property(property(parent, 'id'), 'name')

      return (
        nodeType(declaration) === 'VariableDeclaration' &&
        property(declaration, 'kind') === 'const' &&
        typeof name === 'string' &&
        isScreamingSnakeCase(name)
      )
    }

    current = parent
  }

  return false
}

function unaryLiteralText(node: Rule.Node) {
  const argument = property(node, 'argument')
  if (!isNumericLiteralArgument(argument)) {
    return null
  }

  const raw = literalRaw(argument)
  return raw ? `-${raw}` : null
}

function reportIfMagicNumber(node: Rule.Node, context: Rule.RuleContext) {
  if (isInTypePosition(node) || isInEnumDeclaration(node) || isWithinNamedConstantInitializer(node)) {
    return
  }

  const literalText = isUnaryNegativeNumericLiteral(node) ? unaryLiteralText(node) : literalRaw(node)
  if (!literalText || shouldIgnoreLiteralValue(literalText)) {
    return
  }

  context.report({
    node,
    messageId: 'inlineMagicNumber',
    data: {
      literal: literalText,
    },
  })
}

export const noInlineMagicNumbersRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      inlineMagicNumber:
        'Inline numeric literal {{literal}} is disallowed. Move reusable values to a named SCREAMING_SNAKE_CASE constant.',
      extractionComment:
        'Remove auto-generated numeric-literal extraction comments; constants should be named for domain meaning.',
    },
  },
  create(context) {
    if (isTestFilename(context.filename)) {
      return {}
    }

    return {
      Literal(node: Rule.Node) {
        if (!isNumericLiteral(node) || nodeType(parentOf(node)) === 'UnaryExpression') {
          return
        }

        reportIfMagicNumber(node, context)
      },
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.value.includes(DISALLOWED_EXTRACTION_COMMENT)) {
            if (!comment.loc) {
              continue
            }

            context.report({
              loc: comment.loc,
              messageId: 'extractionComment',
            })
          }
        }
      },
      UnaryExpression(node: Rule.Node) {
        if (isUnaryNegativeNumericLiteral(node)) {
          reportIfMagicNumber(node, context)
        }
      },
    }
  },
}
