import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { formatErrorMessage } from '@shared/utils/node-error'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionLifecycleState,
} from './types'

function runtimeLoadFailedDiagnostic(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly error: unknown
}): ExtensionDiagnostic {
  return {
    severity: 'error',
    code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_LOAD_FAILED,
    message: `Extension runtime loading failed and the extension was disabled: ${formatErrorMessage(input.error)}`,
    path: input.extensionPackage.packagePath,
  }
}

function withoutPreviousRuntimeLoadFailures(
  diagnostics: readonly ExtensionDiagnostic[],
): readonly ExtensionDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.code !== OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_LOAD_FAILED,
  )
}

export function applyRuntimeLoadFailureToLifecycle(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
  readonly error: unknown
  readonly now: number
}): ExtensionLifecycleState {
  return {
    ...input.lifecycle,
    enabled: false,
    grantedCapabilities: [],
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.FAILED,
    lastReloadedAt: null,
    diagnostics: [
      ...withoutPreviousRuntimeLoadFailures(input.lifecycle.diagnostics),
      runtimeLoadFailedDiagnostic(input),
    ],
    updatedAt: input.now,
  }
}
