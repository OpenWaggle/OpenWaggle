import { RepositoryPath } from '@shared/types/brand'
import type { GitWorktreeInfo } from '@shared/types/git'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import { formatWorktreePathForDisplay } from '@shared/utils/worktree'
import { useCallback, useEffect, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state/preferences-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('settings')

const MODE_LABELS: Record<(typeof SESSION_ENVIRONMENT_MODES)[number], string> = {
  local: 'Current checkout',
  worktree: 'New worktree',
}

const MODE_DESCRIPTIONS: Record<(typeof SESSION_ENVIRONMENT_MODES)[number], string> = {
  local: 'Sessions edit files directly in the opened checkout.',
  worktree: 'Each session runs in a dedicated Session worktree isolated from the checkout.',
}

function useProjectWorktrees(repositoryPath: RepositoryPath | null) {
  const [worktrees, setWorktrees] = useState<readonly GitWorktreeInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!repositoryPath) {
      setWorktrees([])
      return
    }
    setIsLoading(true)
    try {
      const result = await api.listGitWorktrees(repositoryPath)
      setWorktrees(result.worktrees)
    } catch (error) {
      logger.warn('Failed to list worktrees', { error: String(error) })
      setWorktrees([])
    } finally {
      setIsLoading(false)
    }
  }, [repositoryPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { worktrees, isLoading, refresh }
}

export function WorktreesSection() {
  const settings = usePreferencesStore((state) => state.settings)
  const setDefaultSessionEnvironmentMode = usePreferencesStore(
    (state) => state.setDefaultSessionEnvironmentMode,
  )
  const projectPath = settings.projectPath
  const repositoryPath = projectPath === null ? null : RepositoryPath(projectPath)
  const { worktrees, isLoading, refresh } = useProjectWorktrees(repositoryPath)
  const [removingPath, setRemovingPath] = useState<string | null>(null)
  const showToast = useUIStore((state) => state.showToast)

  async function handleRemove(worktreePath: string) {
    if (!repositoryPath) return
    setRemovingPath(worktreePath)
    try {
      const result = await api.removeGitWorktree(repositoryPath, { path: worktreePath })
      if (!result.ok) {
        /*
         * Say why. Removal is deliberately refused for a dirty or locked worktree - the common case
         * for a session that is mid-work - and sending the typed message only to the log meant the
         * row stayed put with no explanation, which reads as a broken button.
         */
        logger.warn('Failed to remove worktree', { code: result.code, message: result.message })
        showToast(result.message, 'error')
      }
      await refresh()
    } catch (error) {
      logger.warn('Failed to remove worktree', { error: String(error) })
      showToast('Could not remove the worktree.', 'error')
    } finally {
      setRemovingPath(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">Session environment mode</h3>
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          {SESSION_ENVIRONMENT_MODES.map((mode) => {
            const isActive = settings.defaultSessionEnvironmentMode === mode
            return (
              <Button
                variant="unstyled"
                type="button"
                key={mode}
                onClick={() => {
                  void setDefaultSessionEnvironmentMode(mode)
                }}
                aria-pressed={isActive}
                className="flex w-full items-center justify-between border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-bg-hover"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-text-primary">{MODE_LABELS[mode]}</span>
                  <span className="text-xs text-text-tertiary">{MODE_DESCRIPTIONS[mode]}</span>
                </div>
                <div
                  className={`size-3 shrink-0 rounded-full border ${
                    isActive ? 'border-accent bg-accent' : 'border-border-light'
                  }`}
                />
              </Button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-text-primary">Worktrees</h3>
          <Button variant="secondary" size="xs" disabled={isLoading} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
        {!projectPath ? (
          <p className="text-xs text-text-tertiary">Open a project to manage its worktrees.</p>
        ) : worktrees.length === 0 ? (
          <p className="text-xs text-text-tertiary">
            {isLoading ? 'Loading worktrees…' : 'No worktrees for this repository.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            {worktrees.map((worktree) => (
              <div
                key={worktree.path}
                className="flex items-center justify-between border-b border-border px-5 py-3 last:border-b-0"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-text-primary">
                    {formatWorktreePathForDisplay(worktree.path)}
                    {worktree.isMain ? ' (main)' : ''}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {worktree.branch ?? 'detached'}
                  </span>
                </div>
                {!worktree.isMain && (
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={removingPath === worktree.path}
                    onClick={() => void handleRemove(worktree.path)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
