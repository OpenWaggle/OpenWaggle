import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionManagerView,
  ExtensionPackageLifecycleScope,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  extensionPackagesQueryOptions,
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
}: {
  readonly trustedPending: boolean
  readonly trustedExtensionId: string | null
  readonly enabledPending: boolean
  readonly enabledExtensionId: string | null
  readonly projectDisabledPending: boolean
  readonly projectDisabledExtensionId: string | null
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
  return null
}

function hasPendingMutation({
  trustedPending,
  enabledPending,
  projectDisabledPending,
}: {
  readonly trustedPending: boolean
  readonly enabledPending: boolean
  readonly projectDisabledPending: boolean
}) {
  return trustedPending || enabledPending || projectDisabledPending
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
  const view: ExtensionManagerView | null = extensionsQuery.data ?? null
  const mutationError =
    trustedMutation.error ?? enabledMutation.error ?? projectDisabledMutation.error
  const pendingMutation = hasPendingMutation({
    trustedPending: trustedMutation.isPending,
    enabledPending: enabledMutation.isPending,
    projectDisabledPending: projectDisabledMutation.isPending,
  })
  const updatingExtensionId = getUpdatingExtensionId({
    trustedPending: trustedMutation.isPending,
    trustedExtensionId: trustedMutation.variables?.extensionId ?? null,
    enabledPending: enabledMutation.isPending,
    enabledExtensionId: enabledMutation.variables?.extensionId ?? null,
    projectDisabledPending: projectDisabledMutation.isPending,
    projectDisabledExtensionId: projectDisabledMutation.variables?.extensionId ?? null,
  })
  const error = extensionsQuery.error
    ? describeError(extensionsQuery.error)
    : mutationError
      ? describeError(mutationError)
      : null

  async function refresh() {
    await extensionsQuery.refetch()
  }

  function resetMutations() {
    trustedMutation.reset()
    enabledMutation.reset()
    projectDisabledMutation.reset()
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

  return {
    view,
    loading: extensionsQuery.isFetching || pendingMutation,
    updatingExtensionId,
    error,
    refresh,
    setTrusted,
    setEnabled,
    setProjectDisabled,
  }
}
