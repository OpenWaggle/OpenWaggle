import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'

const FILE_INDEX_STALE_TIME_MS = 30_000

export function workspaceFilesQueryOptions(
  projectPath: string | null,
  query: string,
  limit: number,
) {
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
) {
  return queryOptions({
    queryKey: queryKeys.workspaceContent(projectPath, query, limit),
    enabled: projectPath !== null && query.trim().length > 0,
    queryFn: () => {
      if (!projectPath) throw new Error('Select a project to search file contents.')
      return api.searchWorkspaceContent(projectPath, query, limit)
    },
  })
}

export function workspaceFileQueryOptions(projectPath: string | null, relativePath: string | null) {
  return queryOptions({
    queryKey: queryKeys.workspaceFile(projectPath, relativePath),
    enabled: projectPath !== null && relativePath !== null,
    queryFn: () => {
      if (!projectPath || !relativePath) throw new Error('A project file is required.')
      return api.readWorkspaceFile(projectPath, relativePath)
    },
  })
}
