import { match } from '@diegogbrisa/ts-match'
import type { GitBranchMutationResult } from '@shared/types/git'
import { useEffect, useRef } from 'react'
import { useGit } from '@/features/git/hooks'
import { runBranchMutation } from '@/features/git/lib'
import { useProject } from '@/features/sessions/hooks'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { actionDialogHasInput, getActionDialogConfig } from '../lib/action-dialog-config'
import {
  type ComposerActionDialogKind,
  useComposerActionStore,
} from '../state/composer-action-store'

const NO_PROJECT_RESULT: GitBranchMutationResult = {
  ok: false,
  code: 'unknown',
  message: 'No project selected.',
}

type GitController = ReturnType<typeof useGit>

interface UseActionDialogControllerInput {
  readonly onToast?: (message: string) => void
}

interface ActionDialogMutationInput {
  readonly kind: ComposerActionDialogKind
  readonly actionDialogInput: string
  readonly gitBranch: string | null
  readonly projectPath: string | null
  readonly git: GitController
  readonly setActionDialogError: (error: string | null) => void
  readonly onToast?: (message: string) => void
}

export function useActionDialogController({ onToast }: UseActionDialogControllerInput) {
  const actionDialog = useComposerActionStore((s) => s.actionDialog)
  const actionDialogInput = useComposerActionStore((s) => s.actionDialogInput)
  const actionDialogError = useComposerActionStore((s) => s.actionDialogError)
  const actionDialogBusy = useComposerActionStore((s) => s.actionDialogBusy)
  const closeActionDialog = useComposerActionStore((s) => s.closeActionDialog)
  const setActionDialogInput = useComposerActionStore((s) => s.setActionDialogInput)
  const setActionDialogError = useComposerActionStore((s) => s.setActionDialogError)
  const setActionDialogBusy = useComposerActionStore((s) => s.setActionDialogBusy)
  const { projectPath } = useProject()
  const git = useGit()
  const inputRef = useRef<HTMLInputElement>(null)
  const gitBranch = git.status?.branch ?? null
  const hasInput = actionDialogHasInput(actionDialog)
  const config = actionDialog
    ? getActionDialogConfig(actionDialog, gitBranch, actionDialogInput)
    : null

  useEscapeHotkey(closeDialogIfIdle, { enabled: actionDialog !== null })

  useEffect(() => {
    if (hasInput) requestAnimationFrame(() => inputRef.current?.focus())
  }, [hasInput])

  function closeDialogIfIdle() {
    if (useComposerActionStore.getState().actionDialogBusy) return
    closeActionDialog()
  }

  async function handleConfirm() {
    if (!actionDialog) return
    setActionDialogError(null)
    setActionDialogBusy(true)

    try {
      const mutation = createActionDialogMutation({
        kind: actionDialog,
        actionDialogInput,
        gitBranch,
        projectPath,
        git,
        setActionDialogError,
        onToast,
      })
      if (mutation)
        await closeDialogOnMutationResult(mutation, closeActionDialog, setActionDialogError)
    } catch (error) {
      setActionDialogError(error instanceof Error ? error.message : 'Action failed.')
    } finally {
      setActionDialogBusy(false)
    }
  }

  return {
    actionDialog,
    actionDialogInput,
    actionDialogError,
    actionDialogBusy,
    closeActionDialog,
    setActionDialogInput,
    inputRef,
    config,
    handleConfirm,
  }
}

async function closeDialogOnMutationResult(
  resultPromise: Promise<GitBranchMutationResult>,
  closeActionDialog: () => void,
  setActionDialogError: (error: string | null) => void,
) {
  const errorMessage = await match
    .promise(resultPromise)
    .with({ ok: true }, () => null)
    .with({ ok: false }, (result) => result.message)
    .exhaustive()

  if (errorMessage) {
    setActionDialogError(errorMessage)
    return
  }
  closeActionDialog()
}

function createActionDialogMutation(input: ActionDialogMutationInput) {
  return match(input.kind)
    .with('create-branch', () => createBranchMutation(input))
    .with('rename-branch', () => renameBranchMutation(input))
    .with('delete-branch', () => deleteBranchMutation(input))
    .with('set-upstream', () => setUpstreamMutation(input))
    .exhaustive()
}

function createBranchMutation({
  actionDialogInput,
  projectPath,
  git,
  setActionDialogError,
  onToast,
}: ActionDialogMutationInput) {
  const name = actionDialogInput.trim()
  if (!name) {
    setActionDialogError('Branch name is required.')
    return null
  }
  return runBranchMutation(
    () =>
      projectPath
        ? git.createBranch(projectPath, { name, checkout: true })
        : Promise.resolve(NO_PROJECT_RESULT),
    onToast,
  )
}

function renameBranchMutation({
  actionDialogInput,
  gitBranch,
  projectPath,
  git,
  setActionDialogError,
  onToast,
}: ActionDialogMutationInput) {
  if (!gitBranch) return null
  const target = actionDialogInput.trim()
  if (!target) {
    setActionDialogError('New branch name is required.')
    return null
  }
  return runBranchMutation(
    () =>
      projectPath
        ? git.renameBranch(projectPath, { from: gitBranch, to: target })
        : Promise.resolve(NO_PROJECT_RESULT),
    onToast,
  )
}

function deleteBranchMutation({
  actionDialogInput,
  gitBranch,
  projectPath,
  git,
  setActionDialogError,
  onToast,
}: ActionDialogMutationInput) {
  const target = actionDialogInput.trim() || gitBranch
  if (!target) return null
  if (target === gitBranch) {
    setActionDialogError(
      'Cannot delete the currently checked out branch. Checkout another branch first.',
    )
    return null
  }
  return runBranchMutation(
    () =>
      projectPath
        ? git.deleteBranch(projectPath, { name: target, force: false })
        : Promise.resolve(NO_PROJECT_RESULT),
    onToast,
  )
}

function setUpstreamMutation({
  actionDialogInput,
  gitBranch,
  projectPath,
  git,
  setActionDialogError,
  onToast,
}: ActionDialogMutationInput) {
  if (!gitBranch) return null
  const upstream = actionDialogInput.trim()
  if (!upstream) {
    setActionDialogError('Upstream branch is required.')
    return null
  }
  return runBranchMutation(
    () =>
      projectPath
        ? git.setUpstream(projectPath, { name: gitBranch, upstream })
        : Promise.resolve(NO_PROJECT_RESULT),
    onToast,
  )
}
