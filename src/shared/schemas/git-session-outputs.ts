/**
 * What the window and the Session Host exchange to tie Git work to a Session (ADR 0048): the
 * working path check, the Outputs to record and their recording, and a Session's Change request
 * merge. Each schema is the one source of its type in `@shared/types/vcs` and
 * `@shared/types/change-request`; the Host decodes the requests and the window the answers.
 */
import { Schema } from '@shared/schema'
import { CHANGE_REQUEST_MERGE_METHODS } from '@shared/types/change-request'

/** Where in a Session's tree a Git Output is anchored, captured when the Git action began. */
export const sessionGitOutputOccurrenceSchema = Schema.Struct({
  nodeId: Schema.NullOr(Schema.String),
  branchId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
})

/** The Session Host's answer to whether a working path belongs to a Session. */
export const sessionGitWorkingPathVerificationSchema = Schema.Union(
  Schema.Struct({ owned: Schema.Literal(false) }),
  Schema.Struct({ owned: Schema.Literal(true), occurrence: sessionGitOutputOccurrenceSchema }),
)

/** Git artifacts a Session-scoped action produced, recorded as Outputs by the Session Host. */
export const sessionGitOutputsPayloadSchema = Schema.Struct({
  occurrence: sessionGitOutputOccurrenceSchema,
  commit: Schema.optionalWith(
    Schema.Struct({
      commitHash: Schema.String.pipe(Schema.minLength(1)),
      summary: Schema.String,
    }),
    { exact: true },
  ),
  changeRequest: Schema.optionalWith(
    Schema.Struct({ title: Schema.String, url: Schema.String.pipe(Schema.minLength(1)) }),
    { exact: true },
  ),
})

/** Persistence outcome for a successful Git artifact projected into Session Outputs. */
export const gitOutputRecordingResultSchema = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({
    ok: Schema.Literal(false),
    message: Schema.String,
    retryPersisted: Schema.Boolean,
  }),
)

export const sessionGitOutputsRecordingSchema = Schema.Struct({
  commitOutput: Schema.optionalWith(gitOutputRecordingResultSchema, { exact: true }),
  changeRequestOutput: Schema.optionalWith(gitOutputRecordingResultSchema, { exact: true }),
})

export const mergeChangeRequestPayloadSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.minLength(1)),
  expectedHeadCommit: Schema.String.pipe(Schema.minLength(1)),
  method: Schema.Literal(...CHANGE_REQUEST_MERGE_METHODS),
})
