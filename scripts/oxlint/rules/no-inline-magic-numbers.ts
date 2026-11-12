import type { Context, ESTree, Rule } from '@oxlint/plugins'
import { isTestFilename } from '../ast-helpers.ts'

const NEGATIVE_ONE_LITERAL = '-1'
const NEGATIVE_ZERO_LITERAL = '-0'
const ONE_LITERAL = '1'
const ZERO_LITERAL = '0'
const DISALLOWED_EXTRACTION_COMMENT = 'Extracted from inlined numeric' + ' literal'

function isNumericLiteral(node: ESTree.Node | null): node is ESTree.NumericLiteral {
  return node?.type === 'Literal' && typeof node.value === 'number'
}

function isUnaryNegativeNumericLiteral(node: ESTree.UnaryExpression) {
  return node.operator === '-' && isNumericLiteral(node.argument)
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

function isInTypePosition(node: ESTree.Node) {
  let current = node.parent

  while (current) {
    if (current.type.startsWith('TS')) {
      return true
    }
    current = current.parent
  }

  return false
}

function isInEnumDeclaration(node: ESTree.Node) {
  let current = node.parent

  while (current) {
    if (current.type === 'TSEnumDeclaration') {
      return true
    }
    current = current.parent
  }

  return false
}

function isWithinNamedConstantInitializer(node: ESTree.Node) {
  let current: ESTree.Node = node

  while (current.parent) {
    const { parent } = current
    if (parent.type === 'VariableDeclarator' && parent.init === current) {
      const declaration = parent.parent

      return (
        declaration.type === 'VariableDeclaration' &&
        declaration.kind === 'const' &&
        parent.id.type === 'Identifier' &&
        isScreamingSnakeCase(parent.id.name)
      )
    }

    current = parent
  }

  return false
}

function unaryLiteralText(node: ESTree.UnaryExpression) {
  const { argument } = node
  if (!isNumericLiteral(argument)) {
    return null
  }

  return argument.raw ? `-${argument.raw}` : null
}

function reportIfMagicNumber(
  node: ESTree.NumericLiteral | ESTree.UnaryExpression,
  context: Context,
) {
  if (
    isInTypePosition(node) ||
    isInEnumDeclaration(node) ||
    isWithinNamedConstantInitializer(node)
  ) {
    return
  }

  const literalText = node.type === 'UnaryExpression' ? unaryLiteralText(node) : node.raw
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

export const noInlineMagicNumbersRule: Rule = {
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
      Literal(node) {
        if (!isNumericLiteral(node) || node.parent.type === 'UnaryExpression') {
          return
        }

        reportIfMagicNumber(node, context)
      },
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.value.includes(DISALLOWED_EXTRACTION_COMMENT)) {
            context.report({
              loc: comment.loc,
              messageId: 'extractionComment',
            })
          }
        }
      },
      UnaryExpression(node) {
        if (isUnaryNegativeNumericLiteral(node)) {
          reportIfMagicNumber(node, context)
        }
      },
    }
  },
}
