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
  /** True when this call announced the run; another window may have announced it first. */
  acknowledgeAutomaticWorktreeRemoval(runId: string): Promise<boolean>
}
