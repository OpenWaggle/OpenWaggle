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
  useSetExtensionTrustedMutation,
} from '@/queries/extensions'

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
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load extensions.'
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

export function useExtensionsSectionController(
  projectPath: string | null,
): ExtensionsSectionController {
  const extensionsQuery: UseQueryResult<ExtensionManagerView, Error> = useQuery(
    extensionPackagesQueryOptions(projectPath),
  )
  const trustedMutation = useSetExtensionTrustedMutation(projectPath)
  const enabledMutation = useSetExtensionEnabledMutation(projectPath)
  const view: ExtensionManagerView | null = extensionsQuery.data ?? null
  const mutationError = trustedMutation.error ?? enabledMutation.error
  const updatingExtensionId = trustedMutation.isPending
    ? (trustedMutation.variables?.extensionId ?? null)
    : enabledMutation.isPending
      ? (enabledMutation.variables?.extensionId ?? null)
      : null
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
  }

  async function setTrusted(extensionPackage: ExtensionPackageSummary, trusted: boolean) {
    resetMutations()
    try {
      await trustedMutation.mutateAsync({
        extensionId: extensionPackage.id,
        scope: packageScopeToMutationScope(extensionPackage),
        viewProjectPath: projectPath,
        trusted,
      })
    } catch {
      // TanStack stores the mutation error; keep fire-and-forget click handlers from rejecting.
    }
  }

  async function setEnabled(extensionPackage: ExtensionPackageSummary, enabled: boolean) {
    resetMutations()
    try {
      await enabledMutation.mutateAsync({
        extensionId: extensionPackage.id,
        scope: packageScopeToMutationScope(extensionPackage),
        viewProjectPath: projectPath,
        enabled,
      })
    } catch {
      // TanStack stores the mutation error; keep fire-and-forget click handlers from rejecting.
    }
  }

  return {
    view,
    loading: extensionsQuery.isFetching || trustedMutation.isPending || enabledMutation.isPending,
    updatingExtensionId,
    error,
    refresh,
    setTrusted,
    setEnabled,
  }
}
