import type { GitWorkingTreeMutationResult } from '@shared/types/git'
import { useEffect, useRef, useState } from 'react'
import { selectWorkingTreeStatus, useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

interface UseDiffPanelGitActionsOptions {
  readonly workingPath: string | null
  readonly fallbackHasChanges: boolean
  /** Working-tree mutations are only valid when the panel shows the working tree. */
  readonly canMutateWorkingTree: boolean
  readonly refreshDiff: (workingPath: string) => Promise<void>
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export function useDiffPanelGitActions({
  workingPath,
  fallbackHasChanges,
  canMutateWorkingTree,
  refreshDiff,
}: UseDiffPanelGitActionsOptions) {
  const [isActionRunning, setIsActionRunning] = useState(false)
  const currentWorkingPath = useRef(workingPath)
  useEffect(() => {
    currentWorkingPath.current = workingPath
  }, [workingPath])
  /*
   * This is a WORKING path: for a worktree-mode session it is the Session worktree, not
   * the opened checkout. These are the destructive actions, so the distinction is the
   * difference between staging the agent's work and touching the user's own checkout.
   */
  const gitStatus = useGitStore((state) => selectWorkingTreeStatus(state, workingPath).status)
  const refreshGitStatus = useGitStore((state) => state.refreshStatus)
  const showToast = useUIStore((state) => state.showToast)

  async function executeGitAction(
    workingPathToMutate: string,
    action: (path: string) => Promise<GitWorkingTreeMutationResult>,
    fallbackError: string,
  ) {
    try {
      const result = await action(workingPathToMutate)
      if (currentWorkingPath.current !== workingPathToMutate) return
      if (!result.ok && result.code === 'cancelled') return
      await Promise.all([refreshGitStatus(workingPathToMutate), refreshDiff(workingPathToMutate)])
      if (currentWorkingPath.current !== workingPathToMutate) return
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      if (currentWorkingPath.current !== workingPathToMutate) return
      showToast(errorMessage(error, fallbackError), 'error')
    }
  }

  function handleRevertAll() {
    if (!workingPath || isActionRunning) return

    setIsActionRunning(true)
    void executeGitAction(
      workingPath,
      api.revertAllGitChanges,
      'Failed to revert working-tree changes.',
    ).finally(() => {
      setIsActionRunning(false)
    })
  }

  function handleStageAll() {
    if (!workingPath || isActionRunning) return

    setIsActionRunning(true)
    void executeGitAction(
      workingPath,
      api.stageAllGitChanges,
      'Failed to stage working-tree changes.',
    ).finally(() => {
      setIsActionRunning(false)
    })
  }

  return {
    canRevertAll:
      canMutateWorkingTree &&
      workingPath !== null &&
      (gitStatus ? !gitStatus.clean : fallbackHasChanges),
    canStageAll:
      canMutateWorkingTree &&
      workingPath !== null &&
      (gitStatus ? gitStatus.changedFiles.some((file) => file.unstaged) : fallbackHasChanges),
    isActionRunning,
    handleRevertAll,
    handleStageAll,
  }
}
