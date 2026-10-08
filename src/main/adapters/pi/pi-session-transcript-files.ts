import { Effect, Layer } from 'effect'
import {
  SessionTranscriptFiles,
  SessionTranscriptFilesError,
  type SessionTranscriptLocation,
} from '../../ports/session-transcript-files'
import { findPiSessionFiles, piSessionIdOfFile } from './agent-kernel/session-manager'

/**
 * Pi session files of a Session's transcript, found the way a Pi run rediscovers them: by
 * `*_<piSessionId>.jsonl` in the Pi session directories of the recorded file, the checkout and the
 * worktree. The run directory is always one of the latter two.
 */
export function listPiSessionTranscriptFiles(location: SessionTranscriptLocation) {
  const piSessionId =
    location.transcriptId ??
    (location.transcriptFile ? piSessionIdOfFile(location.transcriptFile) : undefined)
  if (!piSessionId) return []
  return findPiSessionFiles({
    piSessionId,
    ...(location.transcriptFile ? { piSessionFile: location.transcriptFile } : {}),
    projectPath: location.projectPath,
    worktreePath: location.worktreePath,
  })
}

export const PiSessionTranscriptFilesLive = Layer.succeed(
  SessionTranscriptFiles,
  SessionTranscriptFiles.of({
    listTranscriptFiles: (location) =>
      Effect.try({
        try: () => listPiSessionTranscriptFiles(location),
        catch: (cause) => new SessionTranscriptFilesError({ cause }),
      }),
  }),
)
