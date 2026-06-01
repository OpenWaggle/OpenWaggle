import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

type ExtensionPackagesView = Awaited<ReturnType<typeof api.listExtensionPackages>>

export function extensionPackagesQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  ExtensionPackagesView,
  Error,
  ExtensionPackagesView,
  ReturnType<typeof queryKeys.extensionPackages>
> {
  return queryOptions({
    queryKey: queryKeys.extensionPackages(projectPath),
    queryFn: () => api.listExtensionPackages(projectPath),
  })
}
