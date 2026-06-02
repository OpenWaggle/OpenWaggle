import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionPackageLifecycleScope,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('extensions-settings')

export function describeExtensionControllerError(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load extensions.'
}

export function getUpdatingExtensionId({
  trustedPending,
  trustedExtensionId,
  enabledPending,
  enabledExtensionId,
  projectDisabledPending,
  projectDisabledExtensionId,
  updatePending,
  updateExtensionId,
  buildPending,
  buildExtensionId,
  reloadPending,
  reloadExtensionId,
}: {
  readonly trustedPending: boolean
  readonly trustedExtensionId: string | null
  readonly enabledPending: boolean
  readonly enabledExtensionId: string | null
  readonly projectDisabledPending: boolean
  readonly projectDisabledExtensionId: string | null
  readonly updatePending: boolean
  readonly updateExtensionId: string | null
  readonly buildPending: boolean
  readonly buildExtensionId: string | null
  readonly reloadPending: boolean
  readonly reloadExtensionId: string | null
}) {
  if (trustedPending) {
    return trustedExtensionId
  }
  if (enabledPending) {
    return enabledExtensionId
  }
  if (projectDisabledPending) {
    return projectDisabledExtensionId
  }
  if (updatePending) {
    return updateExtensionId
  }
  if (buildPending) {
    return buildExtensionId
  }
  if (reloadPending) {
    return reloadExtensionId
  }
  return null
}

export function hasPendingMutation({
  trustedPending,
  enabledPending,
  projectDisabledPending,
  updatePending,
  buildPending,
  reloadPending,
}: {
  readonly trustedPending: boolean
  readonly enabledPending: boolean
  readonly projectDisabledPending: boolean
  readonly updatePending: boolean
  readonly buildPending: boolean
  readonly reloadPending: boolean
}) {
  return (
    trustedPending ||
    enabledPending ||
    projectDisabledPending ||
    updatePending ||
    buildPending ||
    reloadPending
  )
}

export function mutationError({
  trustedError,
  enabledError,
  projectDisabledError,
  updateError,
  buildError,
  reloadError,
}: {
  readonly trustedError: Error | null
  readonly enabledError: Error | null
  readonly projectDisabledError: Error | null
  readonly updateError: Error | null
  readonly buildError: Error | null
  readonly reloadError: Error | null
}) {
  return (
    trustedError ?? enabledError ?? projectDisabledError ?? updateError ?? buildError ?? reloadError
  )
}

export function controllerError({
  queryError,
  latestMutationError,
}: {
  readonly queryError: Error | null
  readonly latestMutationError: Error | null
}) {
  if (queryError) {
    return describeExtensionControllerError(queryError)
  }
  return latestMutationError ? describeExtensionControllerError(latestMutationError) : null
}

export function packageScopeToMutationScope(
  extensionPackage: ExtensionPackageSummary,
): ExtensionPackageLifecycleScope {
  if (extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND }
  }

  if (!extensionPackage.scope.projectPath) {
    throw new Error('Project extension scope is missing a project path.')
  }

  return {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    projectPath: extensionPackage.scope.projectPath,
  }
}

export function logMutationFailure({
  action,
  extensionPackage,
  projectPath,
  viewProjectPaths,
  error,
}: {
  readonly action: string
  readonly extensionPackage: ExtensionPackageSummary
  readonly projectPath: string | null
  readonly viewProjectPaths: readonly string[]
  readonly error: unknown
}) {
  logger.warn('Extension mutation failed', {
    action,
    extensionId: extensionPackage.id,
    scopeKind: extensionPackage.scope.kind,
    projectPath: projectPath ?? 'none',
    viewProjectPaths,
    error: describeExtensionControllerError(error),
  })
}
