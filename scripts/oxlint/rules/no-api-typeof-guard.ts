import type { Node, Rule } from '@oxlint/plugins'
import { hasNodeType, isLintNode, property } from '../ast-helpers.ts'
import { IPC_BRIDGE_EXPORT, importsIpcBridgeApi } from '../ipc-bridge.ts'

/** The globals the preload object is reachable from without the bridge. */
const WINDOW_GLOBALS = new Set(['window', 'globalThis'])

function identifierName(value: unknown) {
  if (!hasNodeType(value, 'Identifier')) return null
  const name: unknown = property(value, 'name')
  return typeof name === 'string' ? name : null
}

/** `window.api` or `globalThis.api`, read without a computed key. */
function isWindowApi(value: unknown) {
  if (!hasNodeType(value, 'MemberExpression') || property(value, 'computed') === true) return false
  const owner = identifierName(property(value, 'object'))
  return (
    owner !== null &&
    WINDOW_GLOBALS.has(owner) &&
    identifierName(property(value, 'property')) === IPC_BRIDGE_EXPORT
  )
}

/** The object a `typeof` operand reads a member of, or `null` when it reads no member. */
function memberOwner(operand: unknown): unknown {
  const member = hasNodeType(operand, 'ChainExpression') ? property(operand, 'expression') : operand
  return hasNodeType(member, 'MemberExpression') ? property(member, 'object') : null
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
      ImportDeclaration(node: Node) {
        importsIpcBridge ||= importsIpcBridgeApi(node)
      },
      UnaryExpression(node: Node) {
        if (property(node, 'operator') !== 'typeof') return
        const owner = memberOwner(property(node, 'argument'))
        if (!isLintNode(owner)) return
        const bridgeMember = importsIpcBridge && identifierName(owner) === IPC_BRIDGE_EXPORT
        if (!bridgeMember && !isWindowApi(owner)) return
        context.report({ node, messageId: 'noApiTypeofGuard' })
      },
    }
  },
}
