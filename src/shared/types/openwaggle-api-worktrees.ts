import type { IpcInvokeMethod } from './ipc-api-methods'

/** Renderer-facing Settings > Worktrees API (ADR 0060). */
export interface OpenWaggleWorktreesApi {
  getWorktreeInventory: IpcInvokeMethod<'worktrees:inventory'>
  measureWorktree: IpcInvokeMethod<'worktrees:measure'>
  archiveAndRemoveWorktree: IpcInvokeMethod<'worktrees:archive-and-remove'>
  getAutomaticWorktreeRemovalLog: IpcInvokeMethod<'worktrees:automatic-removal-log'>
  /** True when this call announced the run; another window may have announced it first. */
  acknowledgeAutomaticWorktreeRemoval: IpcInvokeMethod<'worktrees:acknowledge-automatic-removal'>
}
