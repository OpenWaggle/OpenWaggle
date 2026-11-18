import { Context, type Effect } from 'effect'

export interface WorktreeSpaceMeasurement {
  readonly reclaimableBytes: number
  readonly measuredAt: number
}

/** Reclaimable space (CONTEXT.md): what removing a worktree folder would free. */
export interface WorktreeSpaceServiceShape {
  /** A measurement newer than the cache window, or a fresh one. */
  readonly measure: (worktreePath: string) => Effect.Effect<WorktreeSpaceMeasurement, Error>
  /** The last measurement still in the cache window, without measuring. */
  readonly cached: (worktreePath: string) => Effect.Effect<WorktreeSpaceMeasurement | null>
  readonly forget: (worktreePath: string) => Effect.Effect<void>
}

export class WorktreeSpaceService extends Context.Tag('@openwaggle/WorktreeSpaceService')<
  WorktreeSpaceService,
  WorktreeSpaceServiceShape
>() {}
