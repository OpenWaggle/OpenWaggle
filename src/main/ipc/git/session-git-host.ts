import { decodeUnknownOrThrow } from '@shared/schema'
import {
  sessionGitOutputsRecordingSchema,
  sessionGitWorkingPathVerificationSchema,
} from '@shared/schemas/git-session-outputs'
import type { SessionId } from '@shared/types/brand'
import { WorkingPath } from '@shared/types/brand'
import type {
  GitRunStackedActionResult,
  SessionGitOutputOccurrence,
  SessionGitOutputsPayload,
  SessionGitOutputsRecording,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { GuiSessionCommandNotAttachedError } from '../../application/gui-session-command'
import { invokeConfiguredHostUi } from '../../application/gui-session-command-router'

/**
 * Ask the Session Host, which owns Sessions, whether this working path is the Session's. The
 * desktop window has no Session store of its own (A-F5).
 */
export function verifySessionGitContext(sessionId: SessionId, workingPath: string) {
  return Effect.gen(function* () {
    const remote = yield* Effect.promise(() =>
      invokeConfiguredHostUi('git:session:verify-working-path', [
        sessionId,
        WorkingPath(workingPath),
      ]),
    )
    if (!remote.handled) return yield* Effect.fail(new GuiSessionCommandNotAttachedError())
    return decodeUnknownOrThrow(sessionGitWorkingPathVerificationSchema, remote.result)
  })
}

function unrecordedOutputs(payload: SessionGitOutputsPayload, error: unknown) {
  const failed = {
    ok: false,
    retryPersisted: false,
    message: `The Output was not recorded: ${error instanceof Error ? error.message : String(error)}`,
  } as const
  return {
    ...(payload.commit ? { commitOutput: failed } : {}),
    ...(payload.changeRequest ? { changeRequestOutput: failed } : {}),
  } satisfies SessionGitOutputsRecording
}

/**
 * Record Session-scoped Git Outputs where Sessions live. The Git work already happened, so a
 * failed recording is reported on the Outputs and never turns the result into an error.
 */
export function recordSessionGitOutputsWhereOwned(
  sessionId: SessionId,
  payload: SessionGitOutputsPayload,
) {
  return Effect.gen(function* () {
    const remote = yield* Effect.tryPromise(async () => {
      const answer = await invokeConfiguredHostUi('git:session:record-outputs', [
        sessionId,
        payload,
      ])
      return answer.handled
        ? {
            handled: true as const,
            recording: decodeUnknownOrThrow(sessionGitOutputsRecordingSchema, answer.result),
          }
        : { handled: false as const }
    })
    if (!remote.handled) return yield* Effect.fail(new GuiSessionCommandNotAttachedError())
    return remote.recording
  }).pipe(Effect.catchAll((error) => Effect.succeed(unrecordedOutputs(payload, error))))
}

const MISSING_COMMIT_HASH_OUTPUT = {
  ok: false,
  retryPersisted: false,
  message: 'The commit was created without a resolvable full hash, so its Output was not recorded.',
} as const

/** Record a stacked action's commit and created change request as Session Outputs. */
export function recordStackedActionOutputsWhereOwned(
  result: GitRunStackedActionResult,
  sessionId: SessionId,
  occurrence: SessionGitOutputOccurrence,
) {
  return Effect.gen(function* () {
    const commit = result.commit ?? null
    const missingHash = commit?.commitHash === null
    const createdRequest = result.ok && result.changeRequest ? result.changeRequest : null
    const payload: SessionGitOutputsPayload = {
      occurrence,
      ...(commit?.commitHash
        ? { commit: { commitHash: commit.commitHash, summary: commit.summary } }
        : {}),
      ...(createdRequest
        ? { changeRequest: { title: createdRequest.title, url: createdRequest.url } }
        : {}),
    }
    const recorded: SessionGitOutputsRecording =
      payload.commit || payload.changeRequest
        ? yield* recordSessionGitOutputsWhereOwned(sessionId, payload)
        : {}
    const commitOutput = missingHash
      ? (commit.commitOutput ?? MISSING_COMMIT_HASH_OUTPUT)
      : recorded.commitOutput
    const withCommit = commitOutput ? { ...result, commitOutput } : result
    if (!withCommit.ok || !recorded.changeRequestOutput) return withCommit
    return { ...withCommit, changeRequestOutput: recorded.changeRequestOutput }
  })
}
