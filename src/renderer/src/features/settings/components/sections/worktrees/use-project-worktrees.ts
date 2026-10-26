import type { RepositoryPath } from '@shared/types/brand'
import type { GitWorktreeInfo } from '@shared/types/git'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import type { WorktreeUsage } from '@shared/types/worktree-usage'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('settings')

export type PreparedWorktree = GitWorktreeInfo & {
  readonly preparation?: WorkspacePreparation
  readonly generationMismatch?: boolean
  readonly generationMismatchMessage?: string
  /** Absent when the Host could not report it; the removal confirmation checks again. */
  readonly usage?: WorktreeUsage
}

async function readRetainedPreparation(repositoryPath: RepositoryPath) {
  const result = await api.manageProjectActions({
    scope: { projectPath: repositoryPath },
    operation: { type: 'retained-preparation' },
  })
  if (result.type !== 'retained-preparation') throw new Error('Unexpected preparation response.')
  return result.workspaces
}

async function readWorktreeUsage(repositoryPath: RepositoryPath) {
  const result = await api.manageProjectActions({
    scope: { projectPath: repositoryPath },
    operation: { type: 'worktree-usage' },
  })
  if (result.type !== 'worktree-usage') throw new Error('Unexpected worktree usage response.')
  return result.worktrees
}

/** The repository's worktrees, joined with cleanup recovery and who uses each one. */
export function useProjectWorktrees(repositoryPath: RepositoryPath | null) {
  const [worktrees, setWorktrees] = useState<readonly PreparedWorktree[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Resolves to the rows it rendered, so a caller can tell what the user now sees. */
  const refresh = useCallback(async (): Promise<readonly PreparedWorktree[]> => {
    if (!repositoryPath) {
      setWorktrees([])
      return []
    }
    setIsLoading(true)
    setError(null)
    try {
      const [listed, preparationResult, usageResult] = await Promise.allSettled([
        api.listGitWorktrees(repositoryPath),
        readRetainedPreparation(repositoryPath),
        readWorktreeUsage(repositoryPath),
      ])
      if (listed.status === 'rejected') throw listed.reason
      const problems = [
        preparationResult.status === 'rejected'
          ? `Could not load cleanup recovery: ${ipcErrorMessage(preparationResult.reason)}`
          : null,
        usageResult.status === 'rejected'
          ? `Could not check which worktrees are in use: ${ipcErrorMessage(usageResult.reason)}`
          : null,
      ].filter((problem) => problem !== null)
      if (problems.length > 0) setError(problems.join(' '))
      const preparations = new Map(
        preparationResult.status === 'fulfilled'
          ? preparationResult.value.map((workspace) => [workspace.path, workspace])
          : [],
      )
      const usage = new Map(
        usageResult.status === 'fulfilled'
          ? usageResult.value.map((entry) => [entry.path, entry])
          : [],
      )
      const rows = listed.value.worktrees.map((worktree) => {
        const recovery = preparations.get(worktree.path)
        return {
          ...worktree,
          preparation: recovery?.preparation,
          generationMismatch: recovery?.generationMismatch,
          generationMismatchMessage: recovery?.generationMismatchMessage,
          usage: usage.get(worktree.path),
        }
      })
      setWorktrees(rows)
      return rows
    } catch (error) {
      logger.warn('Failed to list worktrees', { error: String(error) })
      setError(`Could not list worktrees: ${String(error)}`)
      setWorktrees([])
      return []
    } finally {
      setIsLoading(false)
    }
  }, [repositoryPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { worktrees, isLoading, refresh, error }
}

/** Case-insensitive match on the path, the branch, and the titles of the Sessions using it. */
export function worktreeMatchesSearch(worktree: PreparedWorktree, search: string) {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [
    worktree.path,
    worktree.branch ?? 'detached',
    ...(worktree.usage?.sessions.map((session) => session.title) ?? []),
  ].some((value) => value.toLowerCase().includes(needle))
}
