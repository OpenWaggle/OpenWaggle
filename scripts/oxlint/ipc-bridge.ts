import type { ESTree } from '@oxlint/plugins'
import { sourceValueOf } from './ast-helpers.ts'

/**
 * The renderer's IPC bridge module (`src/renderer/src/shared/lib/ipc.ts`), reached by alias
 * (`@/shared/lib/ipc`, `@shared/lib/…`) or relatively (`../../shared/lib/ipc`).
 */
const IPC_BRIDGE_MODULE = /(?:^|\/)shared\/lib\/ipc$/

/** The binding the bridge exports: the proxy every renderer preload call goes through. */
export const IPC_BRIDGE_EXPORT = 'api'

/** Whether an import declaration binds the bridge's `api` under its own name. */
export function importsIpcBridgeApi(node: ESTree.ImportDeclaration) {
  const source = sourceValueOf(node)
  if (source === null || !IPC_BRIDGE_MODULE.test(source)) return false
  // A namespace import (`* as api`) binds the module, not its `api` export.
  return node.specifiers.some(
    (specifier) =>
      specifier.type !== 'ImportNamespaceSpecifier' && specifier.local.name === IPC_BRIDGE_EXPORT,
  )
}
