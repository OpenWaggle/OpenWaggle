import type { Rule } from 'eslint'
import { hasNodeType, isLintNode, isUnknownArray, property, sourceValueOf } from '../ast-helpers'

/**
 * The renderer's IPC bridge module (`src/renderer/src/shared/lib/ipc.ts`), reached by alias
 * (`@/shared/lib/ipc`, `@shared/lib/…`) or relatively (`../../shared/lib/ipc`).
 */
const IPC_BRIDGE_MODULE = /(?:^|\/)shared\/lib\/ipc$/

/** The binding the bridge exports, which every renderer fire-and-forget call routes through. */
const IPC_BRIDGE_EXPORT = 'api'

/** A chain member call that receives the rejection itself, so nothing after it can float. */
const REJECTION_HANDLER_PROPERTY = 'catch'
/**
 * A chain member call that receives the rejection as its second argument. `Promise.prototype.then`
 * with one argument passes a rejection through, so the chain still floats.
 */
const THEN_PROPERTY = 'then'
/** The argument count at which `then` carries its rejection handler. */
const THEN_REJECTION_HANDLER_ARGUMENT_COUNT = 2

function isImportSpecifier(value: unknown) {
  return hasNodeType(value, 'ImportSpecifier') || hasNodeType(value, 'ImportDefaultSpecifier')
}

/** The name of the identifier a member-call chain is rooted at, or `null` when it has none. */
function bridgeRootName(operand: Rule.Node): string | null {
  let current: unknown = operand
  while (isLintNode(current)) {
    if (hasNodeType(current, 'Identifier')) {
      const name: unknown = property(current, 'name')
      return typeof name === 'string' ? name : null
    }
    if (hasNodeType(current, 'MemberExpression')) {
      current = property(current, 'object')
      continue
    }
    if (hasNodeType(current, 'CallExpression')) {
      current = property(current, 'callee')
      continue
    }
    return null
  }
  return null
}

/** The static name a member call selects, or `null` for a computed member or a plain call. */
function memberPropertyName(call: Rule.Node): string | null {
  const callee: unknown = property(call, 'callee')
  if (!isLintNode(callee) || !hasNodeType(callee, 'MemberExpression')) return null
  if (property(callee, 'computed') === true) return null
  const nameProperty: unknown = property(callee, 'property')
  if (!isLintNode(nameProperty)) return null
  if (hasNodeType(nameProperty, 'Identifier') || hasNodeType(nameProperty, 'StringLiteral')) {
    const name: unknown = property(nameProperty, hasNodeType(nameProperty, 'Identifier') ? 'name' : 'value')
    return typeof name === 'string' ? name : null
  }
  return null
}

/**
 * Whether a `void` operand's member-call chain handles its own rejection. Walks from the outermost
 * call inward: a `.catch`, or a `.then` with a rejection handler, settles everything inside it, and
 * `.finally` passes a rejection through, so only the calls outside one matter.
 */
function chainHandlesRejection(operand: Rule.Node) {
  let current: unknown = operand
  while (isLintNode(current) && hasNodeType(current, 'CallExpression')) {
    const name = memberPropertyName(current)
    if (name === REJECTION_HANDLER_PROPERTY) return true
    if (name === THEN_PROPERTY) {
      const arguments_: unknown = property(current, 'arguments')
      return isUnknownArray(arguments_) && arguments_.length >= THEN_REJECTION_HANDLER_ARGUMENT_COUNT
    }
    if (name === null) return false
    const callee: unknown = property(current, 'callee')
    if (!isLintNode(callee) || !hasNodeType(callee, 'MemberExpression')) return false
    current = property(callee, 'object')
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
export const noUncaughtVoidIpcRule: Rule.RuleModule = {
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
      ImportDeclaration(node: Rule.Node) {
        const source = sourceValueOf(node)
        if (source === null || !IPC_BRIDGE_MODULE.test(source)) return
        const specifiers: unknown = property(node, 'specifiers')
        if (!isUnknownArray(specifiers)) return
        importsIpcBridge ||= specifiers.some((specifier) => {
          if (!isImportSpecifier(specifier) || !isLintNode(specifier)) return false
          const local: unknown = property(specifier, 'local')
          const name: unknown = isLintNode(local) ? property(local, 'name') : null
          return name === IPC_BRIDGE_EXPORT
        })
      },
      UnaryExpression(node: Rule.Node) {
        if (property(node, 'operator') !== 'void' || !importsIpcBridge) return
        const operand: unknown = property(node, 'argument')
        if (!isLintNode(operand)) return
        if (bridgeRootName(operand) !== IPC_BRIDGE_EXPORT) return
        if (chainHandlesRejection(operand)) return
        context.report({ node, messageId: 'noUncaughtVoidIpc' })
      },
    }
  },
}