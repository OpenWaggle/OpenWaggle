import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryView,
  ExtensionLifecycleMutationTarget,
  ExtensionManagerView,
  ExtensionPackageLifecycleScope,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('extensions-settings')

export interface ExtensionsSectionController {
  readonly view: ExtensionManagerView | null
  readonly contributionRegistry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly updatingExtensionId: string | null
  readonly error: string | null
  readonly refresh: () => Promise<void>
  readonly setTrusted: (
    extensionPackage: ExtensionPackageSummary,
    trusted: boolean,
  ) => Promise<void>
  readonly setEnabled: (
    extensionPackage: ExtensionPackageSummary,
    enabled: boolean,
  ) => Promise<void>
  readonly setProjectDisabled: (
    extensionPackage: ExtensionPackageSummary,
    projectPath: string,
    disabled: boolean,
  ) => Promise<void>
  readonly acceptUpdate: (extensionPackage: ExtensionPackageSummary) => Promise<void>
  readonly approveBuild: (extensionPackage: ExtensionPackageSummary) => Promise<void>
  readonly reload: (extensionPackage: ExtensionPackageSummary) => Promise<void>
  readonly remove: (extensionPackage: ExtensionPackageSummary) => Promise<void>
}

interface MutationSnapshot {
  readonly pending: boolean
  readonly error: Error | null
  readonly extensionId: string | null
}

type MutationSlot =
  | 'trusted'
  | 'enabled'
  | 'projectDisabled'
  | 'update'
  | 'build'
  | 'reload'
  | 'remove'
export type MutationSnapshots = Readonly<Record<MutationSlot, MutationSnapshot>>

export function describeExtensionControllerError(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load extensions.'
}

export function mutationSnapshot(input: {
  readonly error: Error | null
  readonly isPending: boolean
  readonly variables: ExtensionLifecycleMutationTarget | undefined
}): MutationSnapshot {
  return {
    error: input.error,
    pending: input.isPending,
    extensionId: input.variables?.extensionId ?? null,
  }
}

export function extensionMutationState(mutations: MutationSnapshots) {
  return {
    latestError: mutationError({
      trustedError: mutations.trusted.error,
      enabledError: mutations.enabled.error,
      projectDisabledError: mutations.projectDisabled.error,
      updateError: mutations.update.error,
      buildError: mutations.build.error,
      reloadError: mutations.reload.error,
      removeError: mutations.remove.error,
    }),
    pending: hasPendingMutation({
      trustedPending: mutations.trusted.pending,
      enabledPending: mutations.enabled.pending,
      projectDisabledPending: mutations.projectDisabled.pending,
      updatePending: mutations.update.pending,
      buildPending: mutations.build.pending,
      reloadPending: mutations.reload.pending,
      removePending: mutations.remove.pending,
    }),
    updatingId: getUpdatingExtensionId({
      trustedPending: mutations.trusted.pending,
      trustedExtensionId: mutations.trusted.extensionId,
      enabledPending: mutations.enabled.pending,
      enabledExtensionId: mutations.enabled.extensionId,
      projectDisabledPending: mutations.projectDisabled.pending,
      projectDisabledExtensionId: mutations.projectDisabled.extensionId,
      updatePending: mutations.update.pending,
      updateExtensionId: mutations.update.extensionId,
      buildPending: mutations.build.pending,
      buildExtensionId: mutations.build.extensionId,
      reloadPending: mutations.reload.pending,
      reloadExtensionId: mutations.reload.extensionId,
      removePending: mutations.remove.pending,
      removeExtensionId: mutations.remove.extensionId,
    }),
  }
}

export function extensionControllerError(input: {
  readonly extensionsError: Error | null
  readonly contributionsError: Error | null
  readonly mutationLatestError: Error | null
}) {
  return (
    controllerError({
      queryError: input.extensionsError,
      latestMutationError: input.mutationLatestError,
    }) ??
    input.contributionsError?.message ??
    null
  )
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
  removePending,
  removeExtensionId,
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
  readonly removePending: boolean
  readonly removeExtensionId: string | null
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
  if (removePending) {
    return removeExtensionId
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
  removePending,
}: {
  readonly trustedPending: boolean
  readonly enabledPending: boolean
  readonly projectDisabledPending: boolean
  readonly updatePending: boolean
  readonly buildPending: boolean
  readonly reloadPending: boolean
  readonly removePending: boolean
}) {
  return (
    trustedPending ||
    enabledPending ||
    projectDisabledPending ||
    updatePending ||
    buildPending ||
    reloadPending ||
    removePending
  )
}

export function mutationError({
  trustedError,
  enabledError,
  projectDisabledError,
  updateError,
  buildError,
  reloadError,
  removeError,
}: {
  readonly trustedError: Error | null
  readonly enabledError: Error | null
  readonly projectDisabledError: Error | null
  readonly updateError: Error | null
  readonly buildError: Error | null
  readonly reloadError: Error | null
  readonly removeError: Error | null
}) {
  return (
    trustedError ??
    enabledError ??
    projectDisabledError ??
    updateError ??
    buildError ??
    reloadError ??
    removeError
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
