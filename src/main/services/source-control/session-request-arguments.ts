import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import {
  mergeChangeRequestPayloadSchema,
  sessionGitOutputsPayloadSchema,
} from '@shared/schemas/git-session-outputs'
import { SessionId } from '@shared/types/brand'

const projectPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((value) => path.isAbsolute(value) || 'Working path must be absolute'),
)
const sessionIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.fromBrand(SessionId))
const requestUrlSchema = Schema.String.pipe(Schema.minLength(1))
/** Decode the untrusted transport arguments shared by every Session-bound request channel. */
export function decodeSessionRequestArguments(
  rawSessionId: unknown,
  rawPath: unknown,
  rawRequest: unknown,
) {
  return {
    sessionId: decodeUnknownOrThrow(sessionIdSchema, rawSessionId),
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
    sessionId: decodeUnknownOrThrow(sessionIdSchema, rawSessionId),
    workingPath: decodeUnknownOrThrow(projectPathSchema, rawPath),
    payload: decodeUnknownOrThrow(mergeChangeRequestPayloadSchema, rawPayload),
  }
}

export function decodeSessionWorkingPathArguments(rawSessionId: unknown, rawPath: unknown) {
  return {
    sessionId: decodeUnknownOrThrow(sessionIdSchema, rawSessionId),
    workingPath: decodeUnknownOrThrow(projectPathSchema, rawPath),
  }
}

export function decodeSessionGitOutputsArguments(rawSessionId: unknown, rawPayload: unknown) {
  return {
    sessionId: decodeUnknownOrThrow(sessionIdSchema, rawSessionId),
    payload: decodeUnknownOrThrow(sessionGitOutputsPayloadSchema, rawPayload),
  }
}
