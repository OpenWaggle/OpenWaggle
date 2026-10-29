import type {
  AutomaticWorktreeRemovalLog,
  AutomaticWorktreeRemovalRun,
} from '@shared/types/worktree-inventory'
import { Context, type Effect } from 'effect'

/** The Host's record of Automatic worktree removal runs (ADR 0060). */
export interface AutomaticWorktreeRemovalLogStoreShape {
  readonly read: () => Effect.Effect<AutomaticWorktreeRemovalLog, Error>
  /** Records a check; the run itself is kept only when it removed or failed something. */
  readonly record: (run: AutomaticWorktreeRemovalRun) => Effect.Effect<void, Error>
  /**
   * The app announces this run; it and every older run are not announced again. True only for
   * the call that changed that, so two windows opening together announce it once.
   */
  readonly acknowledge: (runId: string) => Effect.Effect<boolean, Error>
}

export class AutomaticWorktreeRemovalLogStore extends Context.Tag(
  '@openwaggle/AutomaticWorktreeRemovalLogStore',
)<AutomaticWorktreeRemovalLogStore, AutomaticWorktreeRemovalLogStoreShape>() {}
