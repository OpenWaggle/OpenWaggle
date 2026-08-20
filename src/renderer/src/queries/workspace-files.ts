import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

const FILE_INDEX_STALE_TIME_MS = 30_000
type WorkspaceFiles = Awaited<ReturnType<typeof api.searchWorkspaceFiles>>
type WorkspaceContentMatches = Awaited<ReturnType<typeof api.searchWorkspaceContent>>
type WorkspaceFile = Awaited<ReturnType<typeof api.readWorkspaceFile>>

export function workspaceFilesQueryOptions(
  projectPath: string | null,
  query: string,
  limit: number,
): OpenWaggleQueryOptions<
  WorkspaceFiles,
  Error,
  WorkspaceFiles,
  ReturnType<typeof queryKeys.workspaceFiles>
> {
  return queryOptions({
    queryKey: queryKeys.workspaceFiles(projectPath, query, limit),
    enabled: projectPath !== null,
    staleTime: FILE_INDEX_STALE_TIME_MS,
    queryFn: () => {
      if (!projectPath) throw new Error('Select a project to search files.')
      return api.searchWorkspaceFiles(projectPath, query, limit)
    },
  })
}

export function workspaceContentQueryOptions(
  projectPath: string | null,
  query: string,
  limit: number,
): OpenWaggleQueryOptions<
  WorkspaceContentMatches,
  Error,
  WorkspaceContentMatches,
  ReturnType<typeof queryKeys.workspaceContent>
> {
  return queryOptions({
    queryKey: queryKeys.workspaceContent(projectPath, query, limit),
    enabled: projectPath !== null && query.trim().length > 0,
    queryFn: () => {
      if (!projectPath) throw new Error('Select a project to search file contents.')
      return api.searchWorkspaceContent(projectPath, query, limit)
    },
  })
}

export function workspaceFileQueryOptions(
  projectPath: string | null,
  relativePath: string | null,
): OpenWaggleQueryOptions<
  WorkspaceFile,
  Error,
  WorkspaceFile,
  ReturnType<typeof queryKeys.workspaceFile>
> {
  return queryOptions({
    queryKey: queryKeys.workspaceFile(projectPath, relativePath),
    enabled: projectPath !== null && relativePath !== null,
    queryFn: () => {
      if (!projectPath || !relativePath) throw new Error('A project file is required.')
      return api.readWorkspaceFile(projectPath, relativePath)
    },
  })
}
