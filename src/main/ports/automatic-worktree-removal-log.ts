import type {
  AutomaticWorktreeRemovalLog,
  AutomaticWorktreeRemovalRun,
} from '@shared/types/worktree-inventory'
import { Context, type Effect } from 'effect'

/** The Host's record of Automatic worktree removal runs (ADR 0060). */
export interface AutomaticWorktreeRemovalLogStoreShape {
  readonly read: () => Effect.Effect<AutomaticWorktreeRemovalLog, Error>
  readonly record: (run: AutomaticWorktreeRemovalRun) => Effect.Effect<void, Error>
  /** The app announced this run; it and every older run are not announced again. */
  readonly acknowledge: (runId: string) => Effect.Effect<void, Error>
}

export class AutomaticWorktreeRemovalLogStore extends Context.Tag(
  '@openwaggle/AutomaticWorktreeRemovalLogStore',
)<AutomaticWorktreeRemovalLogStore, AutomaticWorktreeRemovalLogStoreShape>() {}
