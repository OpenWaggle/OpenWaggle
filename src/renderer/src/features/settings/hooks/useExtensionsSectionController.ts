import type {
  ExtensionContributionRegistryView,
  ExtensionLifecycleMutationTarget,
  ExtensionManagerView,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import {
  extensionContributionsQueryOptions,
  extensionPackagesQueryOptions,
  useAcceptExtensionUpdateMutation,
  useApproveExtensionBuildMutation,
  useReloadExtensionMutation,
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
}

type MutationSnapshot = {
  readonly pending: boolean
  readonly error: Error | null
  readonly extensionId: string | null
}

type MutationSlot = 'trusted' | 'enabled' | 'projectDisabled' | 'update' | 'build' | 'reload'
type MutationSnapshots = Readonly<Record<MutationSlot, MutationSnapshot>>

async function refreshProviderModelsAfterExtensionMutation() {
  const settingsSnapshot = usePreferencesStore.getState().settings
  const updatedSettings = await useProviderStore.getState().loadProviderModels(settingsSnapshot)
  if (updatedSettings) {
    usePreferencesStore.setState({ settings: updatedSettings })
  }
}

function mutationSnapshot(input: {
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

function extensionMutationState(mutations: MutationSnapshots) {
  return {
    latestError: mutationError({
      trustedError: mutations.trusted.error,
      enabledError: mutations.enabled.error,
      projectDisabledError: mutations.projectDisabled.error,
      updateError: mutations.update.error,
      buildError: mutations.build.error,
      reloadError: mutations.reload.error,
    }),
    pending: hasPendingMutation({
      trustedPending: mutations.trusted.pending,
      enabledPending: mutations.enabled.pending,
      projectDisabledPending: mutations.projectDisabled.pending,
      updatePending: mutations.update.pending,
      buildPending: mutations.build.pending,
      reloadPending: mutations.reload.pending,
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
    }),
  }
}

function extensionControllerError(input: {
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

export function useExtensionsSectionController(
  projectPaths: readonly string[],
): ExtensionsSectionController {
  const extensionsQuery: UseQueryResult<ExtensionManagerView, Error> = useQuery(
    extensionPackagesQueryOptions(projectPaths),
  )
  const contributionsQuery: UseQueryResult<ExtensionContributionRegistryView, Error> = useQuery(
    extensionContributionsQueryOptions(projectPaths),
  )
  const trustedMutation = useSetExtensionTrustedMutation(projectPaths)
  const enabledMutation = useSetExtensionEnabledMutation(projectPaths)
  const projectDisabledMutation = useSetExtensionProjectDisabledMutation(projectPaths)
  const acceptUpdateMutation = useAcceptExtensionUpdateMutation(projectPaths)
  const approveBuildMutation = useApproveExtensionBuildMutation(projectPaths)
  const reloadMutation = useReloadExtensionMutation(projectPaths)
  const view: ExtensionManagerView | null = extensionsQuery.data ?? null
  const contributionRegistry = contributionsQuery.data ?? null
  const mutationState = extensionMutationState({
    trusted: mutationSnapshot(trustedMutation),
    enabled: mutationSnapshot(enabledMutation),
    projectDisabled: mutationSnapshot(projectDisabledMutation),
    update: mutationSnapshot(acceptUpdateMutation),
    build: mutationSnapshot(approveBuildMutation),
    reload: mutationSnapshot(reloadMutation),
  })
  const error = extensionControllerError({
    extensionsError: extensionsQuery.error,
    contributionsError: contributionsQuery.error,
    mutationLatestError: mutationState.latestError,
  })

  async function refresh() {
    await Promise.all([extensionsQuery.refetch(), contributionsQuery.refetch()])
  }

  function resetMutations() {
    trustedMutation.reset()
    enabledMutation.reset()
    projectDisabledMutation.reset()
    acceptUpdateMutation.reset()
    approveBuildMutation.reset()
    reloadMutation.reset()
  }

  async function runExtensionMutation({
    action,
    extensionPackage,
    projectPath,
    mutate,
  }: {
    readonly action: string
    readonly extensionPackage: ExtensionPackageSummary
    readonly projectPath: string | null
    readonly mutate: () => Promise<ExtensionManagerView>
  }) {
    resetMutations()
    try {
      await mutate()
      await refreshProviderModelsAfterExtensionMutation()
    } catch (error) {
      logMutationFailure({
        action,
        extensionPackage,
        projectPath,
        viewProjectPaths: projectPaths,
        error,
      })
    }
  }

  async function setTrusted(extensionPackage: ExtensionPackageSummary, trusted: boolean) {
    await runExtensionMutation({
      action: 'setTrusted',
      extensionPackage,
      projectPath: null,
      mutate: () =>
        trustedMutation.mutateAsync({
          extensionId: extensionPackage.id,
          scope: packageScopeToMutationScope(extensionPackage),
          viewProjectPaths: projectPaths,
          trusted,
        }),
    })
  }

  async function setEnabled(extensionPackage: ExtensionPackageSummary, enabled: boolean) {
    await runExtensionMutation({
      action: 'setEnabled',
      extensionPackage,
      projectPath: null,
      mutate: () =>
        enabledMutation.mutateAsync({
          extensionId: extensionPackage.id,
          scope: packageScopeToMutationScope(extensionPackage),
          viewProjectPaths: projectPaths,
          enabled,
        }),
    })
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

    await runExtensionMutation({
      action: 'setProjectDisabled',
      extensionPackage,
      projectPath: targetProjectPath,
      mutate: () =>
        projectDisabledMutation.mutateAsync({
          extensionId: extensionPackage.id,
          scope: packageScopeToMutationScope(extensionPackage),
          viewProjectPaths: projectPaths,
          projectPath: targetProjectPath,
          disabled,
        }),
    })
  }

  async function acceptUpdate(extensionPackage: ExtensionPackageSummary) {
    await runExtensionMutation({
      action: 'acceptUpdate',
      extensionPackage,
      projectPath: null,
      mutate: () =>
        acceptUpdateMutation.mutateAsync({
          extensionId: extensionPackage.id,
          scope: packageScopeToMutationScope(extensionPackage),
          viewProjectPaths: projectPaths,
        }),
    })
  }

  async function approveBuild(extensionPackage: ExtensionPackageSummary) {
    await runExtensionMutation({
      action: 'approveBuild',
      extensionPackage,
      projectPath: null,
      mutate: () =>
        approveBuildMutation.mutateAsync({
          extensionId: extensionPackage.id,
          scope: packageScopeToMutationScope(extensionPackage),
          viewProjectPaths: projectPaths,
        }),
    })
  }

  async function reload(extensionPackage: ExtensionPackageSummary) {
    await runExtensionMutation({
      action: 'reload',
      extensionPackage,
      projectPath: null,
      mutate: () =>
        reloadMutation.mutateAsync({
          extensionId: extensionPackage.id,
          scope: packageScopeToMutationScope(extensionPackage),
          viewProjectPaths: projectPaths,
        }),
    })
  }

  return {
    view,
    contributionRegistry,
    loading: extensionsQuery.isFetching || contributionsQuery.isFetching || mutationState.pending,
    updatingExtensionId: mutationState.updatingId,
    error,
    refresh,
    setTrusted,
    setEnabled,
    setProjectDisabled,
    acceptUpdate,
    approveBuild,
    reload,
  }
}
