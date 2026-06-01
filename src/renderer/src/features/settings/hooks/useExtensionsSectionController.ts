import type { ExtensionManagerView } from '@shared/types/extensions'
import { useQuery } from '@tanstack/react-query'
import { extensionPackagesQueryOptions } from '@/queries/extensions'

interface ExtensionsSectionController {
  readonly view: ExtensionManagerView | null
  readonly loading: boolean
  readonly error: string | null
  readonly refresh: () => Promise<void>
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load extensions.'
}

export function useExtensionsSectionController(
  projectPath: string | null,
): ExtensionsSectionController {
  const extensionsQuery = useQuery(extensionPackagesQueryOptions(projectPath))
  const error = extensionsQuery.error ? describeError(extensionsQuery.error) : null

  async function refresh() {
    await extensionsQuery.refetch()
  }

  return {
    view: extensionsQuery.data ?? null,
    loading: extensionsQuery.isFetching,
    error,
    refresh,
  }
}
