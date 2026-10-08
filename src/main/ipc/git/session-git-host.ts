import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { SessionId } from '@shared/types/brand'
import { WorkingPath } from '@shared/types/brand'
import type {
  GitRunStackedActionResult,
  SessionGitOutputOccurrence,
  SessionGitOutputsPayload,
  SessionGitOutputsRecording,
  SessionGitWorkingPathVerification,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { invokeConfiguredHostUi } from '../../application/gui-session-command-router'
import {
  recordSessionGitOutputsOperation,
  verifySessionGitWorkingPath,
} from '../../application/session-git-outputs'

const verificationSchema = Schema.Union(
  Schema.Struct({ owned: Schema.Literal(false) }),
  Schema.Struct({
    owned: Schema.Literal(true),
    occurrence: Schema.Struct({
      nodeId: Schema.NullOr(Schema.String),
      branchId: Schema.NullOr(Schema.String),
      createdAt: Schema.Number,
    }),
  }),
)

const outputRecordingSchema = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({
    ok: Schema.Literal(false),
    message: Schema.String,
    retryPersisted: Schema.Boolean,
  }),
)

const recordingSchema = Schema.Struct({
  commitOutput: Schema.optional(outputRecordingSchema),
  changeRequestOutput: Schema.optional(outputRecordingSchema),
})

/**
 * Ask whoever owns Sessions whether this working path is the Session's. The desktop window's
 * database is isolated, so it asks the Session Host; the owning process checks locally.
 */
export function verifySessionGitContext(sessionId: SessionId, workingPath: string) {
  return Effect.gen(function* () {
    const remote = yield* Effect.promise(() =>
      invokeConfiguredHostUi('git:session:verify-working-path', [
        sessionId,
        WorkingPath(workingPath),
      ]),
    )
    if (remote.handled) {
      return decodeUnknownOrThrow(
        verificationSchema,
        remote.result,
      ) satisfies SessionGitWorkingPathVerification
    }
    return yield* verifySessionGitWorkingPath(sessionId, workingPath)
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
            recording: decodeUnknownOrThrow(recordingSchema, answer.result),
          }
        : { handled: false as const }
    })
    if (remote.handled) return remote.recording satisfies SessionGitOutputsRecording
    return yield* recordSessionGitOutputsOperation(sessionId, payload)
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
    const missingHash = commit !== null && commit.commitHash === null
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
