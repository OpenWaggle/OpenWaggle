import type { GitBranchMutationResult } from '@shared/types/git'
import { useComposerActionStore } from '@/stores/composer-action-store'

/**
 * Runs a branch mutation, updating the composer store's branch message
 * and firing a toast on completion or error.
 */
export async function runBranchMutation(
  run: () => Promise<GitBranchMutationResult>,
  onToast?: (message: string) => void,
): Promise<GitBranchMutationResult> {
  useComposerActionStore.getState().setBranchMessage(null)
  try {
    const result = await run()
    useComposerActionStore.getState().setBranchMessage(result.message)
    onToast?.(result.message)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Branch operation failed.'
    useComposerActionStore.getState().setBranchMessage(message)
    onToast?.(message)
    return { ok: false, code: 'unknown', message }
  }
}
