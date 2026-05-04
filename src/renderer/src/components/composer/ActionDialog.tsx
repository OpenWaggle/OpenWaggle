import { match } from '@diegogbrisa/ts-match'
import type { GitBranchMutationResult } from '@shared/types/git'
import { useEffect, useRef } from 'react'
import { useEscapeHotkey } from '@/hooks/useEscapeHotkey'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { runBranchMutation } from '@/lib/git-branch-mutation'
import {
  type ComposerActionDialogKind,
  useComposerActionStore,
} from '@/stores/composer-action-store'

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
  actionDialogInput: string,
): ActionDialogConfig {
  const currentBranch = gitBranch ?? 'current branch'
  const targetBranch = actionDialogInput.trim() || currentBranch
  return match(kind)
    .with('create-branch', () => ({
      title: 'Create branch',
      description: 'Create and checkout a new branch from the current HEAD.',
      confirmLabel: 'Create',
      confirmTone: 'normal' as const,
      inputPlaceholder: 'feature/my-branch',
    }))
    .with('rename-branch', () => ({
      title: `Rename "${currentBranch}"`,
      description: 'Enter the new branch name.',
      confirmLabel: 'Rename',
      confirmTone: 'normal' as const,
      inputPlaceholder: 'feature/new-name',
    }))
    .with('delete-branch', () => ({
      title: `Delete "${targetBranch}"`,
      description: 'This removes the local branch. This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmTone: 'danger' as const,
    }))
    .with('set-upstream', () => ({
      title: `Set upstream for "${currentBranch}"`,
      description: 'Enter the remote tracking branch (for example origin/main).',
      confirmLabel: 'Set upstream',
      confirmTone: 'normal' as const,
      inputPlaceholder: `origin/${currentBranch}`,
    }))
    .exhaustive()
}

interface ActionDialogProps {
  onToast?: (message: string) => void
}

export function ActionDialog({ onToast }: ActionDialogProps) {
  const actionDialog = useComposerActionStore((s) => s.actionDialog)
  const actionDialogInput = useComposerActionStore((s) => s.actionDialogInput)
  const actionDialogError = useComposerActionStore((s) => s.actionDialogError)
  const actionDialogBusy = useComposerActionStore((s) => s.actionDialogBusy)
  const closeActionDialog = useComposerActionStore((s) => s.closeActionDialog)
  const setActionDialogInput = useComposerActionStore((s) => s.setActionDialogInput)
  const setActionDialogError = useComposerActionStore((s) => s.setActionDialogError)
  const setActionDialogBusy = useComposerActionStore((s) => s.setActionDialogBusy)

  const { projectPath } = useProject()
  const { status: gitStatus, createBranch, renameBranch, deleteBranch, setUpstream } = useGit()

  const inputRef = useRef<HTMLInputElement>(null)
  const gitBranch = gitStatus?.branch ?? null

  const config = actionDialog
    ? getActionDialogConfig(actionDialog, gitBranch, actionDialogInput)
    : null
  const hasInput =
    actionDialog === 'create-branch' ||
    actionDialog === 'rename-branch' ||
    actionDialog === 'set-upstream'

  useEscapeHotkey(
    () => {
      if (useComposerActionStore.getState().actionDialogBusy) return
      closeActionDialog()
    },
    { enabled: actionDialog !== null },
  )

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
      await match(actionDialog)
        .with('create-branch', async () => {
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
        })
        .with('rename-branch', async () => {
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
        })
        .with('delete-branch', async () => {
          const target = actionDialogInput.trim() || gitBranch
          if (!target) return
          if (target === gitBranch) {
            setActionDialogError(
              'Cannot delete the currently checked out branch. Checkout another branch first.',
            )
            return
          }
          const result = await runBranchMutation(
            () =>
              projectPath
                ? deleteBranch(projectPath, { name: target, force: false })
                : Promise.resolve(noProjectResult),
            onToast,
          )
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          closeActionDialog()
        })
        .with('set-upstream', async () => {
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
        })
        .exhaustive()
      setActionDialogBusy(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed.'
      setActionDialogError(message)
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
