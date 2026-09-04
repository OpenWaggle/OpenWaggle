import { createHash, randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import type { RecordSessionChangeRequestInput } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'

const SHORT_COMMIT_HASH_LENGTH = 12

export interface SessionOutputOccurrenceContext {
  readonly nodeId: string | null
  readonly branchId: string | null
  readonly createdAt: number
}

export function resolveSessionOutputOccurrenceContext(sessionId: SessionId) {
  return SessionRepository.pipe(
    Effect.flatMap((sessions) => sessions.getWorkspace(sessionId)),
    Effect.map((workspace) => ({
      nodeId: workspace?.activeNodeId ? String(workspace.activeNodeId) : null,
      branchId: workspace?.activeBranchId ? String(workspace.activeBranchId) : null,
      createdAt: Date.now(),
    })),
  )
}

function stableChangeRequestOccurrenceId(sessionId: SessionId, url: string) {
  const digest = createHash('sha256').update(url).digest('hex')
  return `created:change-request:${sessionId}:${digest}`
}

export function recordSessionChangeRequest(
  sessionId: SessionId,
  input: RecordSessionChangeRequestInput,
  occurrenceContext?: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const context = occurrenceContext ?? (yield* resolveSessionOutputOccurrenceContext(sessionId))
    const createdAt = context.createdAt
    const resourceId = randomUUID()
    return yield* repository.upsert({
      id: resourceId,
      sessionId,
      canonicalKey: `url:${input.url}`,
      kind: 'change-request',
      title: input.title,
      mimeType: null,
      locator: input.url,
      managedPath: null,
      available: true,
      occurrence: {
        id: stableChangeRequestOccurrenceId(sessionId, input.url),
        nodeId: context.nodeId,
        branchId: context.branchId,
        actor: 'user',
        activity: 'created',
        label: null,
        createdAt,
      },
      createdAt,
      updatedAt: createdAt,
    })
  })
}

export function recordSessionCommit(
  sessionId: SessionId,
  input: { readonly commitHash: string; readonly summary: string },
  occurrenceContext?: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const context = occurrenceContext ?? (yield* resolveSessionOutputOccurrenceContext(sessionId))
    const createdAt = context.createdAt
    const resourceId = randomUUID()
    return yield* repository.upsert({
      id: resourceId,
      sessionId,
      canonicalKey: `commit:${input.commitHash}`,
      kind: 'commit',
      title:
        input.summary.trim() || `Commit ${input.commitHash.slice(0, SHORT_COMMIT_HASH_LENGTH)}`,
      mimeType: null,
      locator: null,
      managedPath: null,
      available: true,
      occurrence: {
        id: `created:commit:${sessionId}:${input.commitHash}`,
        nodeId: context.nodeId,
        branchId: context.branchId,
        actor: 'user',
        activity: 'created',
        label: input.commitHash,
        createdAt,
      },
      createdAt,
      updatedAt: createdAt,
    })
  })
}
