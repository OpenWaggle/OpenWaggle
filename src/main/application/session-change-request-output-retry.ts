import { createHash } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import type { RecordSessionChangeRequestInput } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import {
  type PendingChangeRequestSessionOutput,
  type PendingCommitSessionOutput,
  type PendingSessionOutput,
  SessionOutputRetryRepository,
} from '../ports/session-output-retry-repository'
import type { SessionOutputOccurrenceContext } from './session-resource-recording'

export interface PendingCommitOutput {
  readonly commitHash: string
  readonly summary: string
}

function pendingOutputId(sessionId: SessionId, kind: PendingSessionOutput['kind'], key: string) {
  const digest = createHash('sha256')
    .update(String(sessionId))
    .update('\0')
    .update(kind)
    .update('\0')
    .update(key)
    .digest('hex')
  return `pending-output:${kind}:${digest}`
}

export function pendingChangeRequestOutput(
  sessionId: SessionId,
  input: RecordSessionChangeRequestInput,
  occurrenceContext: SessionOutputOccurrenceContext,
): PendingChangeRequestSessionOutput {
  return {
    id: pendingOutputId(sessionId, 'change-request', input.url),
    sessionId,
    kind: 'change-request',
    ...input,
    ...occurrenceContext,
    updatedAt: occurrenceContext.createdAt,
  }
}

export function pendingCommitOutput(
  sessionId: SessionId,
  input: PendingCommitOutput,
  occurrenceContext: SessionOutputOccurrenceContext,
): PendingCommitSessionOutput {
  return {
    id: pendingOutputId(sessionId, 'commit', input.commitHash),
    sessionId,
    kind: 'commit',
    ...input,
    ...occurrenceContext,
    updatedAt: occurrenceContext.createdAt,
  }
}

export function putPendingSessionOutput(output: PendingSessionOutput) {
  return SessionOutputRetryRepository.pipe(Effect.flatMap((repository) => repository.put(output)))
}

export function listPendingSessionOutputs(sessionId: SessionId) {
  return SessionOutputRetryRepository.pipe(
    Effect.flatMap((repository) => repository.list(sessionId)),
  )
}

export function removePendingSessionOutput(output: PendingSessionOutput) {
  return SessionOutputRetryRepository.pipe(
    Effect.flatMap((repository) => repository.remove(output)),
  )
}
