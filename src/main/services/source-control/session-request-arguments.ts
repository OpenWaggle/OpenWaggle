import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type { MergeChangeRequestPayload, SessionGitOutputsPayload } from '@shared/types/git'

const projectPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((value) => path.isAbsolute(value) || 'Working path must be absolute'),
)
const sessionIdSchema = Schema.String.pipe(Schema.minLength(1))
const requestUrlSchema = Schema.String.pipe(Schema.minLength(1))
const mergePayloadSchema = Schema.Struct({
  url: requestUrlSchema,
  expectedHeadCommit: Schema.String.pipe(Schema.minLength(1)),
  method: Schema.Literal('merge', 'squash', 'rebase'),
})
const occurrenceSchema = Schema.Struct({
  nodeId: Schema.NullOr(Schema.String),
  branchId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
})

const sessionGitOutputsSchema = Schema.Struct({
  occurrence: occurrenceSchema,
  commit: Schema.optional(
    Schema.Struct({
      commitHash: Schema.String.pipe(Schema.minLength(1)),
      summary: Schema.String,
    }),
  ),
  changeRequest: Schema.optional(
    Schema.Struct({ title: Schema.String, url: Schema.String.pipe(Schema.minLength(1)) }),
  ),
})

/** Decode the untrusted transport arguments shared by every Session-bound request channel. */
export function decodeSessionRequestArguments(
  rawSessionId: unknown,
  rawPath: unknown,
  rawRequest: unknown,
) {
  return {
    sessionId: SessionId(decodeUnknownOrThrow(sessionIdSchema, rawSessionId)),
    workingPath: decodeUnknownOrThrow(projectPathSchema, rawPath),
    requestUrl: decodeUnknownOrThrow(requestUrlSchema, rawRequest),
  }
}

export function decodeSessionMergeArguments(
  rawSessionId: unknown,
  rawPath: unknown,
  rawPayload: unknown,
) {
  return {
    sessionId: SessionId(decodeUnknownOrThrow(sessionIdSchema, rawSessionId)),
    workingPath: decodeUnknownOrThrow(projectPathSchema, rawPath),
    payload: decodeUnknownOrThrow(
      mergePayloadSchema,
      rawPayload,
    ) satisfies MergeChangeRequestPayload,
  }
}

export function decodeSessionWorkingPathArguments(rawSessionId: unknown, rawPath: unknown) {
  return {
    sessionId: SessionId(decodeUnknownOrThrow(sessionIdSchema, rawSessionId)),
    workingPath: decodeUnknownOrThrow(projectPathSchema, rawPath),
  }
}

export function decodeSessionGitOutputsArguments(rawSessionId: unknown, rawPayload: unknown) {
  return {
    sessionId: SessionId(decodeUnknownOrThrow(sessionIdSchema, rawSessionId)),
    payload: decodeUnknownOrThrow(
      sessionGitOutputsSchema,
      rawPayload,
    ) satisfies SessionGitOutputsPayload,
  }
}
