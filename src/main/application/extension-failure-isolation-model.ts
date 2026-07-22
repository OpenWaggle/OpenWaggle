import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { formatErrorMessage } from '@shared/utils/node-error'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionDiagnosticCode,
  ExtensionPackageScope,
} from '../extensions/types'

const GLOBAL_DISCOVERY_PACKAGE_ID = 'global-extension-discovery'
const PROJECT_DISCOVERY_PACKAGE_ID = 'project-extension-discovery'
const GLOBAL_EXTENSION_ROOT_LABEL = '<global-extension-root>'

function projectExtensionRootLabel(projectPath: string) {
  return `${projectPath}/${OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS.join(
    OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
  )}`
}

function diagnosticPackagePath(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? GLOBAL_EXTENSION_ROOT_LABEL
    : projectExtensionRootLabel(scope.projectPath)
}

function diagnosticPackageId(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? GLOBAL_DISCOVERY_PACKAGE_ID
    : PROJECT_DISCOVERY_PACKAGE_ID
}

function errorCause(error: unknown) {
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return error.cause
  }

  return undefined
}

function formatFailureError(error: unknown) {
  const message = formatErrorMessage(error).trim()
  if (message.length > 0) {
    return message
  }

  const cause = errorCause(error)
  return cause === undefined ? String(error) : formatErrorMessage(cause)
}

export function scopeForProjectPath(projectPath: string | null): ExtensionPackageScope {
  if (projectPath === null) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND }
  }

  return { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath }
}

export function makeExtensionFailureDiagnostic(input: {
  readonly operation: string
  readonly code: ExtensionDiagnosticCode
  readonly error: unknown
  readonly path?: string
}): ExtensionDiagnostic {
  return {
    severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
    code: input.code,
    message: `${input.operation} failed: ${formatFailureError(input.error)}`,
    ...(input.path !== undefined ? { path: input.path } : {}),
  }
}

export function appendExtensionDiagnostics(
  extensionPackage: DiscoveredExtensionPackage,
  diagnostics: readonly ExtensionDiagnostic[],
): DiscoveredExtensionPackage {
  if (diagnostics.length === 0) {
    return extensionPackage
  }

  return {
    ...extensionPackage,
    diagnostics: [...extensionPackage.diagnostics, ...diagnostics],
  }
}

export function appendExtensionDiagnostic(
  extensionPackage: DiscoveredExtensionPackage,
  diagnostic: ExtensionDiagnostic,
): DiscoveredExtensionPackage {
  return appendExtensionDiagnostics(extensionPackage, [diagnostic])
}

export function makeDiscoveryFailurePackage(input: {
  readonly scope: ExtensionPackageScope
  readonly error: unknown
}): DiscoveredExtensionPackage {
  const packagePath = diagnosticPackagePath(input.scope)

  return {
    id: diagnosticPackageId(input.scope),
    scope: input.scope,
    packagePath,
    manifestPath: `${packagePath}/${OPENWAGGLE_EXTENSION.MANIFEST_FILE}`,
    manifest: null,
    buildPlan: null,
    contentHash: null,
    sdkCompatibility: null,
    diagnostics: [
      makeExtensionFailureDiagnostic({
        operation: 'Extension discovery',
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.FILESYSTEM_ERROR,
        error: input.error,
        path: packagePath,
      }),
    ],
  }
}
