import type { GitBranchMutationResult } from '@shared/types/git'
import { useEffect, useRef } from 'react'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { runBranchMutation } from '@/lib/git-branch-mutation'
import type { ComposerActionDialogKind } from '@/stores/composer-store'
import { useComposerStore } from '@/stores/composer-store'
import { useSettingsStore } from '@/stores/settings-store'

interface ActionDialogConfig {
  title: string
  description: string
  confirmLabel: string
  confirmTone: 'normal' | 'danger'
  inputPlaceholder?: string
}

function getActionDialogConfig(
  kind: ComposerActionDialogKind,
  gitBranch: string | null | undefined,
): ActionDialogConfig {
  const currentBranch = gitBranch ?? 'current branch'
  switch (kind) {
    case 'create-branch':
      return {
        title: 'Create branch',
        description: 'Create and checkout a new branch from the current HEAD.',
        confirmLabel: 'Create',
        confirmTone: 'normal',
        inputPlaceholder: 'feature/my-branch',
      }
    case 'rename-branch':
      return {
        title: `Rename "${currentBranch}"`,
        description: 'Enter the new branch name.',
        confirmLabel: 'Rename',
        confirmTone: 'normal',
        inputPlaceholder: 'feature/new-name',
      }
    case 'delete-branch':
      return {
        title: `Delete "${currentBranch}"`,
        description: 'This removes the local branch. This action cannot be undone.',
        confirmLabel: 'Delete',
        confirmTone: 'danger',
      }
    case 'set-upstream':
      return {
        title: `Set upstream for "${currentBranch}"`,
        description: 'Enter the remote tracking branch (for example origin/main).',
        confirmLabel: 'Set upstream',
        confirmTone: 'normal',
        inputPlaceholder: `origin/${currentBranch}`,
      }
    case 'confirm-full-access':
      return {
        title: 'Switch to Full access',
        description:
          'This enables write/edit/command tools. Default permissions runs commands in a sandbox.',
        confirmLabel: 'Switch',
        confirmTone: 'danger',
      }
  }
}

interface ActionDialogProps {
  onToast?: (message: string) => void
}

export function ActionDialog({ onToast }: ActionDialogProps): React.JSX.Element | null {
  const actionDialog = useComposerStore((s) => s.actionDialog)
  const actionDialogInput = useComposerStore((s) => s.actionDialogInput)
  const actionDialogError = useComposerStore((s) => s.actionDialogError)
  const actionDialogBusy = useComposerStore((s) => s.actionDialogBusy)
  const closeActionDialog = useComposerStore((s) => s.closeActionDialog)
  const setActionDialogInput = useComposerStore((s) => s.setActionDialogInput)
  const setActionDialogError = useComposerStore((s) => s.setActionDialogError)
  const setActionDialogBusy = useComposerStore((s) => s.setActionDialogBusy)

  const { projectPath } = useProject()
  const { status: gitStatus, createBranch, renameBranch, deleteBranch, setUpstream } = useGit()
  const setExecutionMode = useSettingsStore((s) => s.setExecutionMode)

  const inputRef = useRef<HTMLInputElement>(null)
  const gitBranch = gitStatus?.branch ?? null

  const config = actionDialog ? getActionDialogConfig(actionDialog, gitBranch) : null
  const hasInput =
    actionDialog === 'create-branch' ||
    actionDialog === 'rename-branch' ||
    actionDialog === 'set-upstream'

  // Escape key closes dialog
  useEffect(() => {
    if (!actionDialog) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      if (useComposerStore.getState().actionDialogBusy) return
      event.preventDefault()
      closeActionDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [actionDialog, closeActionDialog])

  // Auto-focus input
  useEffect(() => {
    if (!hasInput) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [hasInput])

  if (!actionDialog || !config) return null

  const noProjectResult: GitBranchMutationResult = {
    ok: false,
    code: 'unknown',
    message: 'No project selected.',
  }

  async function handleConfirm(): Promise<void> {
    if (!actionDialog) return

    setActionDialogError(null)
    setActionDialogBusy(true)

    try {
      switch (actionDialog) {
        case 'confirm-full-access': {
          await setExecutionMode('full-access')
          closeActionDialog()
          return
        }
        case 'create-branch': {
          const name = actionDialogInput.trim()
          if (!name) {
            setActionDialogError('Branch name is required.')
            return
          }
          const result = await runBranchMutation(
            () =>
              projectPath
                ? createBranch(projectPath, { name, checkout: true })
                : Promise.resolve(noProjectResult),
            onToast,
          )
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          closeActionDialog()
          return
        }
        case 'rename-branch': {
          if (!gitBranch) return
          const target = actionDialogInput.trim()
          if (!target) {
            setActionDialogError('New branch name is required.')
            return
          }
          const result = await runBranchMutation(
            () =>
              projectPath
                ? renameBranch(projectPath, { from: gitBranch, to: target })
                : Promise.resolve(noProjectResult),
            onToast,
          )
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          closeActionDialog()
          return
        }
        case 'delete-branch': {
          if (!gitBranch) return
          const result = await runBranchMutation(
            () =>
              projectPath
                ? deleteBranch(projectPath, { name: gitBranch, force: false })
                : Promise.resolve(noProjectResult),
            onToast,
          )
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          closeActionDialog()
          return
        }
        case 'set-upstream': {
          if (!gitBranch) return
          const upstream = actionDialogInput.trim()
          if (!upstream) {
            setActionDialogError('Upstream branch is required.')
            return
          }
          const result = await runBranchMutation(
            () =>
              projectPath
                ? setUpstream(projectPath, { name: gitBranch, upstream })
                : Promise.resolve(noProjectResult),
            onToast,
          )
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          closeActionDialog()
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed.'
      setActionDialogError(message)
    } finally {
      setActionDialogBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-[360px] rounded-xl border border-border-light bg-bg-secondary p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-text-primary">{config.title}</h3>
        <p className="mt-1 text-[12px] text-text-tertiary">{config.description}</p>

        {config.inputPlaceholder && (
          <input
            ref={inputRef}
            value={actionDialogInput}
            onChange={(event) => setActionDialogInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void handleConfirm()
            }}
            placeholder={config.inputPlaceholder}
            className="mt-3 h-9 w-full rounded-md border border-border bg-bg px-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
          />
        )}

        {actionDialogError && (
          <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-2.5 py-1.5 text-[12px] text-error">
            {actionDialogError}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeActionDialog}
            disabled={actionDialogBusy}
            className="h-8 rounded-md border border-border px-3 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleConfirm()
            }}
            disabled={actionDialogBusy}
            className={cn(
              'h-8 rounded-md px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              config.confirmTone === 'danger'
                ? 'bg-error/20 text-error hover:bg-error/30'
                : 'bg-accent/20 text-accent hover:bg-accent/30',
            )}
          >
            {actionDialogBusy ? 'Working...' : config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
