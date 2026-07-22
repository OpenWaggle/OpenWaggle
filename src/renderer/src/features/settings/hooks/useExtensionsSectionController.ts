import type {
  ExtensionContributionRegistryView,
  ExtensionManagerView,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import {
  extensionContributionsQueryOptions,
  extensionPackagesQueryOptions,
  useAcceptExtensionUpdateMutation,
  useApplyExtensionPackageRemoveMutation,
  useApproveExtensionBuildMutation,
  useReloadExtensionMutation,
  useSetExtensionEnabledMutation,
  useSetExtensionProjectDisabledMutation,
  useSetExtensionTrustedMutation,
} from '@/queries/extensions'
import { runApprovedExtensionRemoveWorkflow } from './extension-remove-workflow'
import {
  describeExtensionControllerError,
  type ExtensionsSectionController,
  extensionControllerError,
  extensionMutationState,
  logMutationFailure,
  mutationSnapshot,
  packageScopeToMutationScope,
} from './extensions-section-controller-model'

async function refreshProviderModelsAfterExtensionMutation() {
  const settingsSnapshot = usePreferencesStore.getState().settings
  const updatedSettings = await useProviderStore.getState().loadProviderModels(settingsSnapshot)
  if (updatedSettings) {
    usePreferencesStore.setState({ settings: updatedSettings })
  }
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
  const removeMutation = useApplyExtensionPackageRemoveMutation(projectPaths)
  const [actionError, setActionError] = useState<string | null>(null)
  const view: ExtensionManagerView | null = extensionsQuery.data ?? null
  const contributionRegistry = contributionsQuery.data ?? null
  const mutationState = extensionMutationState({
    trusted: mutationSnapshot(trustedMutation),
    enabled: mutationSnapshot(enabledMutation),
    projectDisabled: mutationSnapshot(projectDisabledMutation),
    update: mutationSnapshot(acceptUpdateMutation),
    build: mutationSnapshot(approveBuildMutation),
    reload: mutationSnapshot(reloadMutation),
    remove: mutationSnapshot(removeMutation),
  })
  const error =
    extensionControllerError({
      extensionsError: extensionsQuery.error,
      contributionsError: contributionsQuery.error,
      mutationLatestError: mutationState.latestError,
    }) ?? actionError

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
    removeMutation.reset()
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
    setActionError(null)
    try {
      await mutate()
      await refreshProviderModelsAfterExtensionMutation()
    } catch (error) {
      setActionError(describeExtensionControllerError(error))
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

  async function remove(extensionPackage: ExtensionPackageSummary) {
    await runApprovedExtensionRemoveWorkflow({
      extensionPackage,
      projectPaths,
      resetMutations,
      applyRemove: removeMutation.mutateAsync,
      refreshProviderModels: refreshProviderModelsAfterExtensionMutation,
      setActionError,
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
    remove,
  }
}
