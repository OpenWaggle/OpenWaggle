import type { Node } from '@oxlint/plugins'
import { hasNodeType, isLintNode, isUnknownArray, property, sourceValueOf } from './ast-helpers.ts'

/**
 * The renderer's IPC bridge module (`src/renderer/src/shared/lib/ipc.ts`), reached by alias
 * (`@/shared/lib/ipc`, `@shared/lib/…`) or relatively (`../../shared/lib/ipc`).
 */
const IPC_BRIDGE_MODULE = /(?:^|\/)shared\/lib\/ipc$/

/** The binding the bridge exports: the proxy every renderer preload call goes through. */
export const IPC_BRIDGE_EXPORT = 'api'

function isImportSpecifier(value: unknown) {
  return hasNodeType(value, 'ImportSpecifier') || hasNodeType(value, 'ImportDefaultSpecifier')
}

/** Whether an import declaration binds the bridge's `api` under its own name. */
export function importsIpcBridgeApi(node: Node) {
  const source = sourceValueOf(node)
  if (source === null || !IPC_BRIDGE_MODULE.test(source)) return false
  const specifiers: unknown = property(node, 'specifiers')
  if (!isUnknownArray(specifiers)) return false
  return specifiers.some((specifier) => {
    if (!isImportSpecifier(specifier) || !isLintNode(specifier)) return false
    const local: unknown = property(specifier, 'local')
    const name: unknown = isLintNode(local) ? property(local, 'name') : null
    return name === IPC_BRIDGE_EXPORT
  })
}
