import type {
  ExtensionAcceptUpdateInput,
  ExtensionApplyPackageRemoveInput,
  ExtensionApproveBuildInput,
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
  ExtensionListPackagesInput,
  ExtensionManagerView,
  ExtensionReloadInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { rendererQueryClient } from './query-client'
import type { OpenWaggleQueryOptions } from './query-options'

type ExtensionApi = Pick<
  OpenWaggleApi,
  | 'listExtensionContributions'
  | 'listExtensionPackages'
  | 'setExtensionEnabled'
  | 'setExtensionProjectDisabled'
  | 'setExtensionTrusted'
  | 'acceptExtensionUpdate'
  | 'approveExtensionBuild'
  | 'reloadExtension'
  | 'applyExtensionPackageRemove'
>

const extensionApi: ExtensionApi = api
const EXTENSION_CONTRIBUTIONS_QUERY_KEY = 'extensionContributions'

function extensionPackagesQueryKey(projectPaths: readonly string[]) {
  const result: readonly ['extensionPackages', ...string[]] = ['extensionPackages', ...projectPaths]
  return result
}

function extensionContributionsKey(projectPaths: readonly string[], sessionId?: string) {
  const result: readonly ['extensionContributions', ...string[]] = [
    EXTENSION_CONTRIBUTIONS_QUERY_KEY,
    ...projectPaths,
    ...(sessionId !== undefined ? [`session:${sessionId}`] : []),
  ]
  return result
}

function listExtensionPackages(input: ExtensionListPackagesInput) {
  return extensionApi.listExtensionPackages(input)
}

function listExtensionContributions(input: ExtensionListContributionsInput) {
  return extensionApi.listExtensionContributions(input)
}

function extensionContributionsInput(input: {
  readonly projectPaths: readonly string[]
  readonly sessionId?: string
}) {
  const result: ExtensionListContributionsInput = {
    projectPaths: input.projectPaths,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  }
  return result
}

function setExtensionTrusted(input: ExtensionSetTrustedInput) {
  return extensionApi.setExtensionTrusted(input)
}

function setExtensionEnabled(input: ExtensionSetEnabledInput) {
  return extensionApi.setExtensionEnabled(input)
}

function setExtensionProjectDisabled(input: ExtensionSetProjectDisabledInput) {
  return extensionApi.setExtensionProjectDisabled(input)
}

function acceptExtensionUpdate(input: ExtensionAcceptUpdateInput) {
  return extensionApi.acceptExtensionUpdate(input)
}

function approveExtensionBuild(input: ExtensionApproveBuildInput) {
  return extensionApi.approveExtensionBuild(input)
}

function reloadExtension(input: ExtensionReloadInput) {
  return extensionApi.reloadExtension(input)
}

function applyExtensionPackageRemove(input: ExtensionApplyPackageRemoveInput) {
  return extensionApi.applyExtensionPackageRemove(input)
}

function syncExtensionQueriesAfterMutation(input: {
  readonly queryClient: QueryClient
  readonly projectPaths: readonly string[]
  readonly view: ExtensionManagerView
}) {
  input.queryClient.setQueryData(extensionPackagesQueryKey(input.projectPaths), input.view)
  return invalidateExtensionContributionsQueries(input.queryClient)
}

export function invalidateExtensionContributionsQueries(
  queryClient: QueryClient = rendererQueryClient,
) {
  return queryClient.invalidateQueries({
    queryKey: [EXTENSION_CONTRIBUTIONS_QUERY_KEY],
  })
}

export function extensionPackagesQueryOptions(projectPaths: readonly string[]) {
  const queryKey = extensionPackagesQueryKey(projectPaths)

  const options: OpenWaggleQueryOptions<
    ExtensionManagerView,
    Error,
    ExtensionManagerView,
    ReturnType<typeof extensionPackagesQueryKey>
  > = queryOptions({
    queryKey,
    queryFn: () => listExtensionPackages({ projectPaths }),
  })
  return options
}

export function extensionContributionsQueryOptions(
  projectPaths: readonly string[],
  options: { readonly sessionId?: string | null } = {},
) {
  const sessionId = options.sessionId ?? undefined
  const queryKey = extensionContributionsKey(projectPaths, sessionId)

  const result: OpenWaggleQueryOptions<
    ExtensionContributionRegistryView,
    Error,
    ExtensionContributionRegistryView,
    ReturnType<typeof extensionContributionsKey>
  > = queryOptions({
    queryKey,
    queryFn: () =>
      listExtensionContributions(
        extensionContributionsInput({
          projectPaths,
          ...(sessionId === undefined ? {} : { sessionId }),
        }),
      ),
  })
  return result
}

export function useSetExtensionTrustedMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()

  return useMutation<ExtensionManagerView, Error, ExtensionSetTrustedInput>({
    mutationFn: setExtensionTrusted,
    onSuccess: (view) => {
      return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view })
    },
  })
}

export function useSetExtensionEnabledMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()

  return useMutation<ExtensionManagerView, Error, ExtensionSetEnabledInput>({
    mutationFn: setExtensionEnabled,
    onSuccess: (view) => {
      return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view })
    },
  })
}

export function useSetExtensionProjectDisabledMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()

  return useMutation<ExtensionManagerView, Error, ExtensionSetProjectDisabledInput>({
    mutationFn: setExtensionProjectDisabled,
    onSuccess: (view) => {
      return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view })
    },
  })
}

export function useAcceptExtensionUpdateMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()

  return useMutation<ExtensionManagerView, Error, ExtensionAcceptUpdateInput>({
    mutationFn: acceptExtensionUpdate,
    onSuccess: (view) => {
      return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view })
    },
  })
}

export function useApproveExtensionBuildMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()

  return useMutation<ExtensionManagerView, Error, ExtensionApproveBuildInput>({
    mutationFn: approveExtensionBuild,
    onSuccess: (view) => {
      return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view })
    },
  })
}

export function useReloadExtensionMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()

  return useMutation<ExtensionManagerView, Error, ExtensionReloadInput>({
    mutationFn: reloadExtension,
    onSuccess: (view) => {
      return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view })
    },
  })
}

export function useApplyExtensionPackageRemoveMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()

  return useMutation<ExtensionManagerView, Error, ExtensionApplyPackageRemoveInput>({
    mutationFn: applyExtensionPackageRemove,
    onSuccess: (view) => {
      return syncExtensionQueriesAfterMutation({ queryClient, projectPaths, view })
    },
  })
}
