import type {
  ExtensionManagerView,
  ExtensionSetEnabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import type { OpenWaggleQueryOptions } from './query-options'

type ExtensionPackagesQueryKey = readonly ['extensionPackages', string | null]

export function extensionPackagesQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  ExtensionManagerView,
  Error,
  ExtensionManagerView,
  ExtensionPackagesQueryKey
> {
  const queryKey: ExtensionPackagesQueryKey = ['extensionPackages', projectPath]

  return queryOptions({
    queryKey,
    queryFn: () => api.listExtensionPackages(projectPath),
  })
}

export function useSetExtensionTrustedMutation(projectPath: string | null) {
  const queryClient = useQueryClient()
  const queryKey: ExtensionPackagesQueryKey = ['extensionPackages', projectPath]

  return useMutation<ExtensionManagerView, Error, ExtensionSetTrustedInput>({
    mutationFn: (input: ExtensionSetTrustedInput) => api.setExtensionTrusted(input),
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}

export function useSetExtensionEnabledMutation(projectPath: string | null) {
  const queryClient = useQueryClient()
  const queryKey: ExtensionPackagesQueryKey = ['extensionPackages', projectPath]

  return useMutation<ExtensionManagerView, Error, ExtensionSetEnabledInput>({
    mutationFn: (input: ExtensionSetEnabledInput) => api.setExtensionEnabled(input),
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view)
    },
  })
}
