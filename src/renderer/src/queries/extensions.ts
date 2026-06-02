import type {
  ExtensionAcceptUpdateInput,
  ExtensionApproveBuildInput,
  ExtensionListPackagesInput,
  ExtensionManagerView,
  ExtensionReloadInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import type { OpenWaggleQueryOptions } from './query-options'

type ExtensionApi = Pick<
  OpenWaggleApi,
  | 'listExtensionPackages'
  | 'setExtensionEnabled'
  | 'setExtensionProjectDisabled'
  | 'setExtensionTrusted'
  | 'acceptExtensionUpdate'
  | 'approveExtensionBuild'
  | 'reloadExtension'
>

const extensionApi: ExtensionApi = api

function extensionPackagesQueryKey(
  projectPaths: readonly string[],
): readonly ['extensionPackages', ...string[]] {
  return ['extensionPackages', ...projectPaths]
}

function listExtensionPackages(input: ExtensionListPackagesInput): Promise<ExtensionManagerView> {
  return extensionApi.listExtensionPackages(input)
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

export function useSetExtensionTrustedMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()
  const queryKey = extensionPackagesQueryKey(projectPaths)

  return useMutation<ExtensionManagerView, Error, ExtensionSetTrustedInput>({
    mutationFn: setExtensionTrusted,
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}

export function useSetExtensionEnabledMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()
  const queryKey = extensionPackagesQueryKey(projectPaths)

  return useMutation<ExtensionManagerView, Error, ExtensionSetEnabledInput>({
    mutationFn: setExtensionEnabled,
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}

export function useSetExtensionProjectDisabledMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()
  const queryKey = extensionPackagesQueryKey(projectPaths)

  return useMutation<ExtensionManagerView, Error, ExtensionSetProjectDisabledInput>({
    mutationFn: setExtensionProjectDisabled,
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}

export function useAcceptExtensionUpdateMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()
  const queryKey = extensionPackagesQueryKey(projectPaths)

  return useMutation<ExtensionManagerView, Error, ExtensionAcceptUpdateInput>({
    mutationFn: acceptExtensionUpdate,
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}

export function useApproveExtensionBuildMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()
  const queryKey = extensionPackagesQueryKey(projectPaths)

  return useMutation<ExtensionManagerView, Error, ExtensionApproveBuildInput>({
    mutationFn: approveExtensionBuild,
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}

export function useReloadExtensionMutation(projectPaths: readonly string[]) {
  const queryClient = useQueryClient()
  const queryKey = extensionPackagesQueryKey(projectPaths)

  return useMutation<ExtensionManagerView, Error, ExtensionReloadInput>({
    mutationFn: reloadExtension,
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}
