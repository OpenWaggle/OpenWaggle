import type { Node, Rule } from '@oxlint/plugins'
import { hasNodeType, isUnknownArray, property } from '../ast-helpers.ts'

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression'])
const INDEX_PARAMETER_COUNT = 2

function calledMemberName(callee: unknown) {
  if (!hasNodeType(callee, 'MemberExpression')) {
    return null
  }
  const key = property(callee, 'property')
  if (property(callee, 'computed') !== true) {
    const name = property(key, 'name')
    return typeof name === 'string' ? name : null
  }
  const value = property(key, 'value')
  return typeof value === 'string' ? value : null
}

function callbackIgnoresIndex(callback: unknown) {
  const type = property(callback, 'type')
  if (typeof type !== 'string' || !FUNCTION_TYPES.has(type)) {
    return false
  }
  const params = property(callback, 'params')
  return isUnknownArray(params) && params.length < INDEX_PARAMETER_COUNT
}

// Ports Biome's complexity/noForEach: any `.forEach(callback)` whose inline callback does not
// take the index is written as `for...of` instead. A callback that uses the index, a callback
// passed by name, and `forEach` helpers whose first argument is not the callback (such as
// Effect.forEach(items, f)) are allowed, as they were under Biome.
export const noForEachRule: Rule = {
  meta: {
    type: 'suggestion',
    messages: {
      preferForOf: 'Prefer for...of over forEach unless the callback uses the index.',
    },
  },
  create(context) {
    return {
      CallExpression(node: Node) {
        const args = property(node, 'arguments')
        if (calledMemberName(property(node, 'callee')) !== 'forEach' || !isUnknownArray(args)) {
          return
        }
        if (callbackIgnoresIndex(args[0])) {
          context.report({ node, messageId: 'preferForOf' })
        }
      },
    }
  },
}
