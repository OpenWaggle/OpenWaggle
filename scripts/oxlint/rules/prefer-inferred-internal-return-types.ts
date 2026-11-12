import type { Context, ESTree, Rule } from '@oxlint/plugins'
import { rangeFrom } from '../ast-helpers.ts'

const SIMPLE_RETURN_TYPE_NAMES = new Set([
  'TSStringKeyword',
  'TSNumberKeyword',
  'TSBooleanKeyword',
  'TSVoidKeyword',
  'TSUndefinedKeyword',
  'TSNullKeyword',
])

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression

function isExportedFunction({ parent }: FunctionNode) {
  if (
    parent.type === 'ExportDefaultDeclaration' ||
    parent.type === 'ExportNamedDeclaration' ||
    parent.type === 'MethodDefinition' ||
    parent.type === 'PropertyDefinition'
  ) {
    return true
  }

  return parent.parent?.type === 'ExportNamedDeclaration'
}

function functionName(node: FunctionNode) {
  if (node.id) {
    return node.id.name
  }

  const { parent } = node
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name
  }

  return null
}

function isRecursiveFunction(node: FunctionNode, context: Context) {
  const name = functionName(node)
  const range = rangeFrom(node.body)
  if (!name || !range) {
    return false
  }

  return context.sourceCode.text.slice(range.start, range.end).includes(name)
}

function isSimpleReturnType(returnType: ESTree.TSTypeAnnotation) {
  return SIMPLE_RETURN_TYPE_NAMES.has(returnType.typeAnnotation.type)
}

export const preferInferredInternalReturnTypesRule: Rule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    messages: {
      preferInference:
        'Prefer inferred return types for internal functions. Keep explicit returns for exported/public API boundaries only.',
    },
  },
  create(context) {
    function check(node: FunctionNode) {
      const { returnType } = node
      if (
        !returnType ||
        isExportedFunction(node) ||
        isRecursiveFunction(node, context) ||
        !isSimpleReturnType(returnType)
      ) {
        return
      }

      context.report({
        node: returnType,
        messageId: 'preferInference',
        fix(fixer) {
          return fixer.remove(returnType)
        },
      })
    }

    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
    }
  },
}
