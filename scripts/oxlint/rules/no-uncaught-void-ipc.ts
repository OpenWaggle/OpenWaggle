import type { ESTree, Rule } from '@oxlint/plugins'
import { IPC_BRIDGE_EXPORT, importsIpcBridgeApi } from '../ipc-bridge.ts'

/** A chain member call that receives the rejection itself, so nothing after it can float. */
const REJECTION_HANDLER_PROPERTY = 'catch'
/**
 * A chain member call that receives the rejection as its second argument. `Promise.prototype.then`
 * with one argument passes a rejection through, so the chain still floats.
 */
const THEN_PROPERTY = 'then'
/** The argument count at which `then` carries its rejection handler. */
const THEN_REJECTION_HANDLER_ARGUMENT_COUNT = 2

/** The name of the identifier a member-call chain is rooted at, or `null` when it has none. */
function bridgeRootName(operand: ESTree.Expression) {
  let current: ESTree.Expression | ESTree.Super = operand
  while (true) {
    if (current.type === 'Identifier') return current.name
    if (current.type === 'MemberExpression') {
      current = current.object
      continue
    }
    if (current.type === 'CallExpression') {
      current = current.callee
      continue
    }
    return null
  }
}

/** The static name a member call selects, or `null` for a computed member or a plain call. */
function memberPropertyName({ callee }: ESTree.CallExpression) {
  if (callee.type !== 'MemberExpression' || callee.computed) return null
  return callee.property.type === 'Identifier' ? callee.property.name : null
}

/**
 * Whether a `void` operand's member-call chain handles its own rejection. Walks from the outermost
 * call inward: a `.catch`, or a `.then` with a rejection handler, settles everything inside it, and
 * `.finally` passes a rejection through, so only the calls outside one matter.
 */
function chainHandlesRejection(operand: ESTree.Expression) {
  let current: ESTree.Expression = operand
  while (current.type === 'CallExpression') {
    const name = memberPropertyName(current)
    if (name === REJECTION_HANDLER_PROPERTY) return true
    if (name === THEN_PROPERTY) {
      return current.arguments.length >= THEN_REJECTION_HANDLER_ARGUMENT_COUNT
    }
    if (name === null || current.callee.type !== 'MemberExpression') return false
    current = current.callee.object
  }
  return false
}

/**
 * A `void api.<method>()` call starts a fire-and-forget IPC request, but IPC rejections cross the
 * bridge as a new `Error` with the message and no stack, and error reporting (ADR 0045) drops the
 * message text, so an unhandled rejection of one is reported only as a bare code such as
 * `Error: unknown`, with nothing to find the caller by. Every fire-and-forget bridge call must
 * attach `.catch` or a `.then` rejection handler.
 */
export const noUncaughtVoidIpcRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      noUncaughtVoidIpc:
        'A `void api.*()` fire-and-forget IPC call must handle its rejection: attach `.catch`, or a `.then` rejection handler, or the rejection becomes an unhandled renderer error reported only as a bare code.',
    },
  },
  create(context) {
    let importsIpcBridge = false
    return {
      ImportDeclaration(node) {
        importsIpcBridge ||= importsIpcBridgeApi(node)
      },
      UnaryExpression(node) {
        if (node.operator !== 'void' || !importsIpcBridge) return
        const operand = node.argument
        if (bridgeRootName(operand) !== IPC_BRIDGE_EXPORT) return
        if (chainHandlesRejection(operand)) return
        context.report({ node, messageId: 'noUncaughtVoidIpc' })
      },
    }
  },
}
