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

function extensionPackagesQueryKey(
  projectPaths: readonly string[],
): readonly ['extensionPackages', ...string[]] {
  return ['extensionPackages', ...projectPaths]
}

function extensionContributionsKey(
  projectPaths: readonly string[],
  sessionId?: string,
): readonly ['extensionContributions', ...string[]] {
  return [
    EXTENSION_CONTRIBUTIONS_QUERY_KEY,
    ...projectPaths,
    ...(sessionId !== undefined ? [`session:${sessionId}`] : []),
  ]
}

function listExtensionPackages(input: ExtensionListPackagesInput): Promise<ExtensionManagerView> {
  return extensionApi.listExtensionPackages(input)
}

function listExtensionContributions(
  input: ExtensionListContributionsInput,
): Promise<ExtensionContributionRegistryView> {
  return extensionApi.listExtensionContributions(input)
}

function extensionContributionsInput(input: {
  readonly projectPaths: readonly string[]
  readonly sessionId?: string
}): ExtensionListContributionsInput {
  return {
    projectPaths: input.projectPaths,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  }
}

function setExtensionTrusted(input: ExtensionSetTrustedInput): Promise<ExtensionManagerView> {
  return extensionApi.setExtensionTrusted(input)
}

function setExtensionEnabled(input: ExtensionSetEnabledInput): Promise<ExtensionManagerView> {
  return extensionApi.setExtensionEnabled(input)
}

function setExtensionProjectDisabled(
  input: ExtensionSetProjectDisabledInput,
): Promise<ExtensionManagerView> {
  return extensionApi.setExtensionProjectDisabled(input)
}

function acceptExtensionUpdate(input: ExtensionAcceptUpdateInput): Promise<ExtensionManagerView> {
  return extensionApi.acceptExtensionUpdate(input)
}

function approveExtensionBuild(input: ExtensionApproveBuildInput): Promise<ExtensionManagerView> {
  return extensionApi.approveExtensionBuild(input)
}

function reloadExtension(input: ExtensionReloadInput): Promise<ExtensionManagerView> {
  return extensionApi.reloadExtension(input)
}

function applyExtensionPackageRemove(
  input: ExtensionApplyPackageRemoveInput,
): Promise<ExtensionManagerView> {
  return extensionApi.applyExtensionPackageRemove(input)
}

function syncExtensionQueriesAfterMutation(input: {
  readonly queryClient: QueryClient
  readonly projectPaths: readonly string[]
  readonly view: ExtensionManagerView
}) {
  input.queryClient.setQueryData(extensionPackagesQueryKey(input.projectPaths), input.view)
  return input.queryClient.invalidateQueries({
    queryKey: [EXTENSION_CONTRIBUTIONS_QUERY_KEY],
  })
}

export function extensionPackagesQueryOptions(
  projectPaths: readonly string[],
): OpenWaggleQueryOptions<
  ExtensionManagerView,
  Error,
  ExtensionManagerView,
  ReturnType<typeof extensionPackagesQueryKey>
> {
  const queryKey = extensionPackagesQueryKey(projectPaths)

  return queryOptions({
    queryKey,
    queryFn: () => listExtensionPackages({ projectPaths }),
  })
}

export function extensionContributionsQueryOptions(
  projectPaths: readonly string[],
  options: { readonly sessionId?: string | null } = {},
): OpenWaggleQueryOptions<
  ExtensionContributionRegistryView,
  Error,
  ExtensionContributionRegistryView,
  ReturnType<typeof extensionContributionsKey>
> {
  const sessionId = options.sessionId ?? undefined
  const queryKey = extensionContributionsKey(projectPaths, sessionId)

  return queryOptions({
    queryKey,
    queryFn: () =>
      listExtensionContributions(extensionContributionsInput({ projectPaths, sessionId })),
  })
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
