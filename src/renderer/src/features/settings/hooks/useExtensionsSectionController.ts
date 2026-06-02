import type { ExtensionManagerView, ExtensionPackageSummary } from '@shared/types/extensions'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  extensionPackagesQueryOptions,
  useAcceptExtensionUpdateMutation,
  useApproveExtensionBuildMutation,
  useSetExtensionEnabledMutation,
  useSetExtensionProjectDisabledMutation,
  useSetExtensionTrustedMutation,
} from '@/queries/extensions'
import {
  controllerError,
  getUpdatingExtensionId,
  hasPendingMutation,
  logMutationFailure,
  mutationError,
  packageScopeToMutationScope,
} from './extensions-section-controller-model'

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
  readonly approveBuild: (extensionPackage: ExtensionPackageSummary) => Promise<void>
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
  const approveBuildMutation = useApproveExtensionBuildMutation(projectPaths)
  const view: ExtensionManagerView | null = extensionsQuery.data ?? null
  const latestMutationError = mutationError({
    trustedError: trustedMutation.error,
    enabledError: enabledMutation.error,
    projectDisabledError: projectDisabledMutation.error,
    updateError: acceptUpdateMutation.error,
    buildError: approveBuildMutation.error,
  })
  const pendingMutation = hasPendingMutation({
    trustedPending: trustedMutation.isPending,
    enabledPending: enabledMutation.isPending,
    projectDisabledPending: projectDisabledMutation.isPending,
    updatePending: acceptUpdateMutation.isPending,
    buildPending: approveBuildMutation.isPending,
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
    buildPending: approveBuildMutation.isPending,
    buildExtensionId: approveBuildMutation.variables?.extensionId ?? null,
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
    approveBuildMutation.reset()
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

  async function approveBuild(extensionPackage: ExtensionPackageSummary) {
    resetMutations()
    try {
      await approveBuildMutation.mutateAsync({
        extensionId: extensionPackage.id,
        scope: packageScopeToMutationScope(extensionPackage),
        viewProjectPaths: projectPaths,
      })
    } catch (error) {
      logMutationFailure({
        action: 'approveBuild',
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
    approveBuild,
  }
}
