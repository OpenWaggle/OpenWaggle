import type { RepositoryPath } from './brand'
import type { GitWorktreeMutationResult } from './git'
import type {
  AutomaticWorktreeRemovalLog,
  WorktreeArchiveAndRemovePayload,
  WorktreeInventory,
  WorktreeReclaimableSpace,
} from './worktree-inventory'

/** Settings > Worktrees across every project (ADR 0060), served by the Session Host. */
export interface IpcWorktreesInvokeChannelMap {
  'worktrees:inventory': { args: []; return: WorktreeInventory }
  'worktrees:measure': {
    args: [repositoryPath: RepositoryPath, worktreePath: string]
    return: WorktreeReclaimableSpace
  }
  'worktrees:archive-and-remove': {
    args: [repositoryPath: RepositoryPath, payload: WorktreeArchiveAndRemovePayload]
    return: GitWorktreeMutationResult
  }
  'worktrees:automatic-removal-log': { args: []; return: AutomaticWorktreeRemovalLog }
  'worktrees:acknowledge-automatic-removal': { args: [runId: string]; return: undefined }
}
