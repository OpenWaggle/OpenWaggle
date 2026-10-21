/** A managed worktree folder as seen by `lstat`, recorded when its preparation is captured. */
export interface WorkspaceDirectoryIdentity {
  /** `st_dev` is diagnostic only: macOS renumbers volumes on reboot, so it is never compared. */
  readonly device: string
  readonly inode: string
  readonly birthtime: string
}

/** Why a worktree does or does not still match the checkout its preparation was captured in. */
export type WorkspaceGenerationCheck =
  | { readonly status: 'current' }
  | { readonly status: 'unrecorded'; readonly workspacePath: string }
  | {
      readonly status: 'unreadable'
      readonly workspacePath: string
      readonly recorded: WorkspaceDirectoryIdentity
    }
  | {
      readonly status: 'replaced'
      readonly workspacePath: string
      readonly recorded: WorkspaceDirectoryIdentity
      readonly observed: WorkspaceDirectoryIdentity
    }
