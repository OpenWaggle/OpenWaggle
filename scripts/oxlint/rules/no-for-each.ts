import type { ESTree, Rule } from '@oxlint/plugins'

const INDEX_PARAMETER_COUNT = 2

/** The member a call names: `.name`, or a string literal key (`['name']`). */
function calledMemberName(callee: ESTree.Expression) {
  if (callee.type !== 'MemberExpression') {
    return null
  }
  if (callee.computed) {
    const key = callee.property
    return key.type === 'Literal' && typeof key.value === 'string' ? key.value : null
  }
  return callee.property.name
}

function callbackIgnoresIndex(callback: ESTree.Argument | undefined) {
  if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression') {
    return false
  }
  return callback.params.length < INDEX_PARAMETER_COUNT
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
      CallExpression(node) {
        if (calledMemberName(node.callee) !== 'forEach') {
          return
        }
        if (callbackIgnoresIndex(node.arguments[0])) {
          context.report({ node, messageId: 'preferForOf' })
        }
      },
    }
  },
}
