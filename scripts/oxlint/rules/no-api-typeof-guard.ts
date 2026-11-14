import type { ESTree, Rule } from '@oxlint/plugins'
import { IPC_BRIDGE_EXPORT, importsIpcBridgeApi } from '../ipc-bridge.ts'

/** The globals the preload object is reachable from without the bridge. */
const WINDOW_GLOBALS = new Set(['window', 'globalThis'])

function identifierName(node: ESTree.Node) {
  return node.type === 'Identifier' ? node.name : null
}

/** `window.api` or `globalThis.api`, read without a computed key. */
function isWindowApi(node: ESTree.Node) {
  if (node.type !== 'MemberExpression' || node.computed) return false
  const owner = identifierName(node.object)
  return (
    owner !== null &&
    WINDOW_GLOBALS.has(owner) &&
    identifierName(node.property) === IPC_BRIDGE_EXPORT
  )
}

/** The object a `typeof` operand reads a member of, or `null` when it reads no member. */
function memberOwner(operand: ESTree.Expression) {
  const member = operand.type === 'ChainExpression' ? operand.expression : operand
  return member.type === 'MemberExpression' ? member.object : null
}

/**
 * The renderer's `api` is a proxy that answers every property name with a function, so
 * `typeof api.method === 'function'` is true even when the preload never loaded: the guard never
 * runs its fallback, and the code behind it is dead (one hid a long paste that then vanished). The
 * typed preload contract makes every member exist; handle the call's rejection instead, or ask a
 * real capability. Type queries (`ReturnType<typeof api.method>`) are not values and pass.
 */
export const noApiTypeofGuardRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      noApiTypeofGuard:
        '`typeof api.*` is always "function": the api proxy answers every name. The typed preload contract makes the member exist; handle the call\'s rejection, or check a real capability.',
    },
  },
  create(context) {
    let importsIpcBridge = false
    return {
      ImportDeclaration(node) {
        importsIpcBridge ||= importsIpcBridgeApi(node)
      },
      UnaryExpression(node) {
        if (node.operator !== 'typeof') return
        const owner = memberOwner(node.argument)
        if (owner === null) return
        const bridgeMember = importsIpcBridge && identifierName(owner) === IPC_BRIDGE_EXPORT
        if (!bridgeMember && !isWindowApi(owner)) return
        context.report({ node, messageId: 'noApiTypeofGuard' })
      },
    }
  },
}
