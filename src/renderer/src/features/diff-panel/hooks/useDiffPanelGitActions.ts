import type { GitWorkingTreeMutationResult } from '@shared/types/git'
import { useEffect, useRef, useState } from 'react'
import { selectWorkingTreeStatus, useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

interface UseDiffPanelGitActionsOptions {
  readonly projectPath: string | null
  readonly fallbackHasChanges: boolean
  /** Working-tree mutations are only valid when the panel shows the working tree. */
  readonly canMutateWorkingTree: boolean
  readonly refreshDiff: (projectPath: string) => Promise<void>
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export function useDiffPanelGitActions({
  projectPath,
  fallbackHasChanges,
  canMutateWorkingTree,
  refreshDiff,
}: UseDiffPanelGitActionsOptions) {
  const [isActionRunning, setIsActionRunning] = useState(false)
  const currentProjectPath = useRef(projectPath)
  useEffect(() => {
    currentProjectPath.current = projectPath
  }, [projectPath])
  // Status for the tree this panel is actually showing, not for the project.
  const gitStatus = useGitStore((state) => selectWorkingTreeStatus(state, projectPath).status)
  const refreshGitStatus = useGitStore((state) => state.refreshStatus)
  const showToast = useUIStore((state) => state.showToast)

  async function executeGitAction(
    projectPathToMutate: string,
    action: (path: string) => Promise<GitWorkingTreeMutationResult>,
    fallbackError: string,
  ) {
    try {
      const result = await action(projectPathToMutate)
      if (currentProjectPath.current !== projectPathToMutate) return
      if (!result.ok && result.code === 'cancelled') return
      await Promise.all([refreshGitStatus(projectPathToMutate), refreshDiff(projectPathToMutate)])
      if (currentProjectPath.current !== projectPathToMutate) return
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      if (currentProjectPath.current !== projectPathToMutate) return
      showToast(errorMessage(error, fallbackError), 'error')
    }
  }

  function handleRevertAll() {
    if (!projectPath || isActionRunning) return

    setIsActionRunning(true)
    void executeGitAction(
      projectPath,
      api.revertAllGitChanges,
      'Failed to revert working-tree changes.',
    ).finally(() => {
      setIsActionRunning(false)
    })
  }

  function handleStageAll() {
    if (!projectPath || isActionRunning) return

    setIsActionRunning(true)
    void executeGitAction(
      projectPath,
      api.stageAllGitChanges,
      'Failed to stage working-tree changes.',
    ).finally(() => {
      setIsActionRunning(false)
    })
  }

  return {
    canRevertAll:
      canMutateWorkingTree &&
      projectPath !== null &&
      (gitStatus ? !gitStatus.clean : fallbackHasChanges),
    canStageAll:
      canMutateWorkingTree &&
      projectPath !== null &&
      (gitStatus ? gitStatus.changedFiles.some((file) => file.unstaged) : fallbackHasChanges),
    isActionRunning,
    handleRevertAll,
    handleStageAll,
  }
}
