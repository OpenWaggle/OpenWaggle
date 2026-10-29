import type { RepositoryPath } from './brand'
import type { GitWorktreeMutationResult } from './git'
import type {
  AutomaticWorktreeRemovalLog,
  WorktreeArchiveAndRemovePayload,
  WorktreeInventory,
  WorktreeReclaimableSpace,
} from './worktree-inventory'

/** Renderer-facing Settings > Worktrees API (ADR 0060). */
export interface OpenWaggleWorktreesApi {
  getWorktreeInventory(): Promise<WorktreeInventory>
  measureWorktree(
    repositoryPath: RepositoryPath,
    worktreePath: string,
  ): Promise<WorktreeReclaimableSpace>
  archiveAndRemoveWorktree(
    repositoryPath: RepositoryPath,
    payload: WorktreeArchiveAndRemovePayload,
  ): Promise<GitWorktreeMutationResult>
  getAutomaticWorktreeRemovalLog(): Promise<AutomaticWorktreeRemovalLog>
  acknowledgeAutomaticWorktreeRemoval(runId: string): Promise<void>
}
