import { Context, Data, type Effect } from 'effect'

/**
 * Finds the files a Session's agent-runtime transcript is stored in.
 *
 * A Session records one transcript file, but the runtime can hold the same transcript in other
 * files as well: a first run that stopped before its file was recorded, or abandoned copies under
 * the same transcript id. The runtime rediscovers those files by transcript id, so anything that
 * must remove a Session's transcript has to find every one of them, and nothing of another
 * transcript.
 */
export class SessionTranscriptFilesError extends Data.TaggedError('SessionTranscriptFilesError')<{
  readonly cause: unknown
}> {}

export interface SessionTranscriptLocation {
  /** The transcript id. Defaults to the id the recorded file is named for. */
  readonly transcriptId?: string
  /** The transcript file the Session recorded, if any. */
  readonly transcriptFile: string | null
  readonly projectPath: string | null
  readonly worktreePath: string | null
}

export interface SessionTranscriptFilesShape {
  /**
   * Every existing file of the transcript, newest first, in each place the runtime looks for it.
   * Empty when the transcript id is unknown.
   */
  readonly listTranscriptFiles: (
    location: SessionTranscriptLocation,
  ) => Effect.Effect<readonly string[], SessionTranscriptFilesError>
}

export class SessionTranscriptFiles extends Context.Tag('@openwaggle/SessionTranscriptFiles')<
  SessionTranscriptFiles,
  SessionTranscriptFilesShape
>() {}
