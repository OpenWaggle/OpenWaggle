import { Context, Data, type Effect } from 'effect'
import type { PersistSessionSnapshotInput } from './session-repository'

/**
 * Renames transcript entries whose ids another Session's projection already holds.
 *
 * Node ids are the agent runtime's entry ids, and the projection keys every Session's nodes by
 * id alone. An entry that reuses another Session's id can never be saved, so the transcript
 * itself must give it a new id. The result is the snapshot re-projected from the renamed
 * transcript, or null when the conflicting ids are not entries of the transcript.
 *
 * Callers must hold the Session's lock and must not have a live agent session on the transcript.
 */
export class SessionTranscriptRepairError extends Data.TaggedError('SessionTranscriptRepairError')<{
  readonly cause: unknown
}> {}

export interface SessionTranscriptRepairShape {
  readonly renameForeignEntryIds: (
    input: PersistSessionSnapshotInput,
    foreignNodeIds: ReadonlySet<string>,
  ) => Effect.Effect<PersistSessionSnapshotInput | null, SessionTranscriptRepairError>
}

export class SessionTranscriptRepair extends Context.Tag('@openwaggle/SessionTranscriptRepair')<
  SessionTranscriptRepair,
  SessionTranscriptRepairShape
>() {}
