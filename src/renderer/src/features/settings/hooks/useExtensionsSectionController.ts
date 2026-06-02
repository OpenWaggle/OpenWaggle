import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionManagerView,
  ExtensionPackageLifecycleScope,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  extensionPackagesQueryOptions,
  useAcceptExtensionUpdateMutation,
  useSetExtensionEnabledMutation,
  useSetExtensionProjectDisabledMutation,
  useSetExtensionTrustedMutation,
} from '@/queries/extensions'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('extensions-settings')

export interface ExtensionsSectionController {
  readonly view: ExtensionManagerView | null
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
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load extensions.'
}

function getUpdatingExtensionId({
  trustedPending,
  trustedExtensionId,
  enabledPending,
  enabledExtensionId,
  projectDisabledPending,
  projectDisabledExtensionId,
  updatePending,
  updateExtensionId,
}: {
  readonly trustedPending: boolean
  readonly trustedExtensionId: string | null
  readonly enabledPending: boolean
  readonly enabledExtensionId: string | null
  readonly projectDisabledPending: boolean
  readonly projectDisabledExtensionId: string | null
  readonly updatePending: boolean
  readonly updateExtensionId: string | null
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
  return null
}

function hasPendingMutation({
  trustedPending,
  enabledPending,
  projectDisabledPending,
  updatePending,
}: {
  readonly trustedPending: boolean
  readonly enabledPending: boolean
  readonly projectDisabledPending: boolean
  readonly updatePending: boolean
}) {
  return trustedPending || enabledPending || projectDisabledPending || updatePending
}

function mutationError({
  trustedError,
  enabledError,
  projectDisabledError,
  updateError,
}: {
  readonly trustedError: Error | null
  readonly enabledError: Error | null
  readonly projectDisabledError: Error | null
  readonly updateError: Error | null
}) {
  return trustedError ?? enabledError ?? projectDisabledError ?? updateError
}

function controllerError({
  queryError,
  latestMutationError,
}: {
  readonly queryError: Error | null
  readonly latestMutationError: Error | null
}) {
  if (queryError) {
    return describeError(queryError)
  }
  return latestMutationError ? describeError(latestMutationError) : null
}

function packageScopeToMutationScope(
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

function logMutationFailure({
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
    error: describeError(error),
  })
}

export function useExtensionsSectionController(
  projectPaths: readonly string[],
): ExtensionsSectionController {
  const extensionsQuery: UseQueryResult<ExtensionManagerView, Error> = useQuery(
    extensionPackagesQueryOptions(projectPaths),
  )
  const trustedMutation = useSetExtensionTrustedMutation(projectPaths)
  const enabledMutation = useSetExtensionEnabledMutation(projectPaths)
  const projectDisabledMutation = useSetExtensionProjectDisabledMutation(projectPaths)
  const acceptUpdateMutation = useAcceptExtensionUpdateMutation(projectPaths)
  const view: ExtensionManagerView | null = extensionsQuery.data ?? null
  const latestMutationError = mutationError({
    trustedError: trustedMutation.error,
    enabledError: enabledMutation.error,
    projectDisabledError: projectDisabledMutation.error,
    updateError: acceptUpdateMutation.error,
  })
  const pendingMutation = hasPendingMutation({
    trustedPending: trustedMutation.isPending,
    enabledPending: enabledMutation.isPending,
    projectDisabledPending: projectDisabledMutation.isPending,
    updatePending: acceptUpdateMutation.isPending,
  })
  const updatingExtensionId = getUpdatingExtensionId({
    trustedPending: trustedMutation.isPending,
    trustedExtensionId: trustedMutation.variables?.extensionId ?? null,
    enabledPending: enabledMutation.isPending,
    enabledExtensionId: enabledMutation.variables?.extensionId ?? null,
    projectDisabledPending: projectDisabledMutation.isPending,
    projectDisabledExtensionId: projectDisabledMutation.variables?.extensionId ?? null,
    updatePending: acceptUpdateMutation.isPending,
    updateExtensionId: acceptUpdateMutation.variables?.extensionId ?? null,
  })
  const error = controllerError({
    queryError: extensionsQuery.error,
    latestMutationError,
  })

  async function refresh() {
    await extensionsQuery.refetch()
  }

  function resetMutations() {
    trustedMutation.reset()
    enabledMutation.reset()
    projectDisabledMutation.reset()
    acceptUpdateMutation.reset()
  }

  async function setTrusted(extensionPackage: ExtensionPackageSummary, trusted: boolean) {
    resetMutations()
    try {
      await trustedMutation.mutateAsync({
        extensionId: extensionPackage.id,
        scope: packageScopeToMutationScope(extensionPackage),
        viewProjectPaths: projectPaths,
        trusted,
      })
    } catch (error) {
      logMutationFailure({
        action: 'setTrusted',
        extensionPackage,
        projectPath: null,
        viewProjectPaths: projectPaths,
        error,
      })
      // TanStack stores the mutation error; keep fire-and-forget click handlers from rejecting.
    }
  }

  async function setEnabled(extensionPackage: ExtensionPackageSummary, enabled: boolean) {
    resetMutations()
    try {
      await enabledMutation.mutateAsync({
        extensionId: extensionPackage.id,
        scope: packageScopeToMutationScope(extensionPackage),
        viewProjectPaths: projectPaths,
        enabled,
      })
    } catch (error) {
      logMutationFailure({
        action: 'setEnabled',
        extensionPackage,
        projectPath: null,
        viewProjectPaths: projectPaths,
        error,
      })
      // TanStack stores the mutation error; keep fire-and-forget click handlers from rejecting.
    }
  }

  async function setProjectDisabled(
    extensionPackage: ExtensionPackageSummary,
    projectPath: string,
    disabled: boolean,
  ) {
    const targetProjectPath = projectPath.trim()
    if (targetProjectPath.length === 0) {
      return
    }

    resetMutations()
    try {
      await projectDisabledMutation.mutateAsync({
        extensionId: extensionPackage.id,
        scope: packageScopeToMutationScope(extensionPackage),
        viewProjectPaths: projectPaths,
        projectPath: targetProjectPath,
        disabled,
      })
    } catch (error) {
      logMutationFailure({
        action: 'setProjectDisabled',
        extensionPackage,
        projectPath: targetProjectPath,
        viewProjectPaths: projectPaths,
        error,
      })
      // TanStack stores the mutation error; keep fire-and-forget click handlers from rejecting.
    }
  }

  async function acceptUpdate(extensionPackage: ExtensionPackageSummary) {
    resetMutations()
    try {
      await acceptUpdateMutation.mutateAsync({
        extensionId: extensionPackage.id,
        scope: packageScopeToMutationScope(extensionPackage),
        viewProjectPaths: projectPaths,
      })
    } catch (error) {
      logMutationFailure({
        action: 'acceptUpdate',
        extensionPackage,
        projectPath: null,
        viewProjectPaths: projectPaths,
        error,
      })
      // TanStack stores the mutation error; keep fire-and-forget click handlers from rejecting.
    }
  }

  return {
    view,
    loading: extensionsQuery.isFetching || pendingMutation,
    updatingExtensionId,
    error,
    refresh,
    setTrusted,
    setEnabled,
    setProjectDisabled,
    acceptUpdate,
  }
}
