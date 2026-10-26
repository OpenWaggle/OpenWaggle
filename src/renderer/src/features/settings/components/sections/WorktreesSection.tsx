import { RepositoryPath } from '@shared/types/brand'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state/preferences-store'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { useUIStore } from '@/shell/ui-store'
import {
  type PreparedWorktree,
  useProjectWorktrees,
  worktreeMatchesSearch,
} from './worktrees/use-project-worktrees'
import {
  WorktreeRemovalDialog,
  type WorktreeRemovalRequest,
} from './worktrees/WorktreeRemovalDialog'
import { WorktreeRow } from './worktrees/WorktreeRow'

const logger = createRendererLogger('settings')

const MODE_LABELS: Record<(typeof SESSION_ENVIRONMENT_MODES)[number], string> = {
  local: 'Current checkout',
  worktree: 'New worktree',
}

const MODE_DESCRIPTIONS: Record<(typeof SESSION_ENVIRONMENT_MODES)[number], string> = {
  local: 'Sessions edit files directly in the opened checkout.',
  worktree: 'Each session runs in a dedicated Session worktree isolated from the checkout.',
}

/**
 * A cleanup failure or refusal is shown in full under the row once the list refreshes, which a
 * brief toast cannot do. When the refreshed row has no recovery to show it, the toast says why.
 */
function removalFailureToast(
  result: { readonly code: string; readonly message: string },
  refreshed: readonly PreparedWorktree[],
  worktreePath: string,
) {
  const reasonShown = refreshed.some((row) => row.path === worktreePath && row.preparation)
  return result.code === 'cleanup-failed' && reasonShown
    ? 'The worktree was kept. The reason is shown under it.'
    : result.message
}

function WorktreeSearch(props: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly shown: number
  readonly total: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-tertiary"
        />
        <TextInput
          type="search"
          inputSize="sm"
          aria-label="Search worktrees"
          placeholder="Search paths, branches and Sessions…"
          autoComplete="off"
          spellCheck={false}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && props.value) {
              event.stopPropagation()
              props.onChange('')
            }
          }}
          className="pl-8"
        />
      </div>
      <span className="text-xs text-text-tertiary" aria-live="polite">
        {props.shown === props.total
          ? `${String(props.total)} worktrees`
          : `${String(props.shown)} of ${String(props.total)} worktrees`}
      </span>
    </div>
  )
}

export function WorktreesSection() {
  const settings = usePreferencesStore((state) => state.settings)
  const projectPath = settings.projectPath
  const repositoryPath = projectPath === null ? null : RepositoryPath(projectPath)
  const { worktrees, isLoading, refresh, error } = useProjectWorktrees(repositoryPath)
  const [removingPath, setRemovingPath] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<WorktreeRemovalRequest | null>(null)
  const [search, setSearch] = useState('')
  const showToast = useUIStore((state) => state.showToast)
  const visible = worktrees.filter((worktree) => worktreeMatchesSearch(worktree, search))

  async function handleRemove(request: WorktreeRemovalRequest) {
    if (!repositoryPath) return
    setPendingRemoval(null)
    setRemovingPath(request.path)
    try {
      const result = await api.removeGitWorktree(repositoryPath, {
        path: request.path,
        ...(request.skipCleanup ? { skipCleanup: true } : {}),
        ...(request.force ? { force: true } : {}),
      })
      if (!result.ok) {
        /*
         * Say why. Removal is deliberately refused for a dirty, locked or in-use worktree - the
         * common case for a session that is mid-work - and sending the typed message only to the
         * log meant the row stayed put with no explanation, which reads as a broken button.
         */
        logger.warn('Failed to remove worktree', { code: result.code, message: result.message })
        showToast(removalFailureToast(result, await refresh(), request.path), 'error')
      } else await refresh()
    } catch (error) {
      logger.warn('Failed to remove worktree', { error: String(error) })
      showToast(`Could not remove the worktree: ${ipcErrorMessage(error)}`, 'error')
      await refresh()
    } finally {
      setRemovingPath(null)
    }
  }

  return (
    <div className="space-y-6">
      <WorktreeEnvironmentMode />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-text-primary">Worktrees</h3>
          <Button variant="secondary" size="xs" disabled={isLoading} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-error-text">
            {error}
          </p>
        ) : null}
        {!projectPath ? (
          <p className="text-xs text-text-tertiary">Open a project to manage its worktrees.</p>
        ) : worktrees.length === 0 ? (
          <p className="text-xs text-text-tertiary">
            {isLoading ? 'Loading worktrees…' : 'No worktrees for this repository.'}
          </p>
        ) : (
          <>
            <WorktreeSearch
              value={search}
              onChange={setSearch}
              shown={visible.length}
              total={worktrees.length}
            />
            {visible.length === 0 ? (
              <p className="text-xs text-text-tertiary">No worktrees match this search.</p>
            ) : (
              <ul
                aria-label="Worktrees"
                className="overflow-hidden rounded-lg border border-border bg-bg"
              >
                {visible.map((worktree) => (
                  <WorktreeRow
                    key={worktree.path}
                    projectPath={projectPath}
                    worktree={worktree}
                    busy={removingPath === worktree.path}
                    onRequestRemoval={setPendingRemoval}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {repositoryPath && pendingRemoval ? (
        <WorktreeRemovalDialog
          repositoryPath={repositoryPath}
          request={pendingRemoval}
          onConfirm={(request) => void handleRemove(request)}
          onClose={() => setPendingRemoval(null)}
        />
      ) : null}
    </div>
  )
}

function WorktreeEnvironmentMode() {
  const settings = usePreferencesStore((state) => state.settings)
  const setDefaultSessionEnvironmentMode = usePreferencesStore(
    (state) => state.setDefaultSessionEnvironmentMode,
  )
  return (
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
  )
}
