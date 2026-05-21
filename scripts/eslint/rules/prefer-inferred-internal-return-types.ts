import type { Rule } from 'eslint'
import {
  hasNodeType,
  isLintNode,
  nodeType,
  parentOf,
  property,
  rangeFrom,
  type NodeWithReturnType,
} from '../ast-helpers'

const SIMPLE_RETURN_TYPE_NAMES = new Set([
  'TSStringKeyword',
  'TSNumberKeyword',
  'TSBooleanKeyword',
  'TSVoidKeyword',
  'TSUndefinedKeyword',
  'TSNullKeyword',
])

function isExportedFunction(node: Rule.Node) {
  const parent = parentOf(node)
  const grandparent = parentOf(parent)

  if (
    hasNodeType(parent, 'ExportDefaultDeclaration') ||
    hasNodeType(parent, 'ExportNamedDeclaration')
  ) {
    return true
  }

  if (hasNodeType(parent, 'MethodDefinition') || hasNodeType(parent, 'PropertyDefinition')) {
    return true
  }

  return hasNodeType(grandparent, 'ExportNamedDeclaration')
}

function functionName(node: Rule.Node) {
  const idName = property(property(node, 'id'), 'name')
  if (typeof idName === 'string') {
    return idName
  }

  const parent = parentOf(node)
  const variableName = property(property(parent, 'id'), 'name')
  if (hasNodeType(parent, 'VariableDeclarator') && typeof variableName === 'string') {
    return variableName
  }

  return null
}

function isRecursiveFunction(node: Rule.Node, context: Rule.RuleContext) {
  const name = functionName(node)
  const range = rangeFrom(property(node, 'body'))
  if (!name || !range) {
    return false
  }

  return context.sourceCode.text.slice(range.start, range.end).includes(name)
}

function hasRemovableReturnType(node: Rule.Node): node is Rule.Node & NodeWithReturnType {
  return isLintNode(property(node, 'returnType')) && property(node, 'body') !== undefined
}

function isSimpleReturnType(returnType: Rule.Node) {
  const annotationType = nodeType(property(returnType, 'typeAnnotation'))
  return annotationType !== null && SIMPLE_RETURN_TYPE_NAMES.has(annotationType)
}

export const preferInferredInternalReturnTypesRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    messages: {
      preferInference:
        'Prefer inferred return types for internal functions. Keep explicit returns for exported/public API boundaries only.',
    },
  },
  create(context) {
    function check(node: Rule.Node) {
      if (
        !hasRemovableReturnType(node) ||
        isExportedFunction(node) ||
        isRecursiveFunction(node, context) ||
        !isSimpleReturnType(node.returnType)
      ) {
        return
      }

      context.report({
        node: node.returnType,
        messageId: 'preferInference',
        fix(fixer) {
          return fixer.remove(node.returnType)
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
