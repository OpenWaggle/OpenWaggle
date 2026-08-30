import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import type { RecordSessionChangeRequestInput } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'

export function recordSessionChangeRequest(
  sessionId: SessionId,
  input: RecordSessionChangeRequestInput,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const sessions = yield* SessionRepository
    const workspace = yield* sessions.getWorkspace(sessionId)
    const createdAt = Date.now()
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
        id: `created:change-request:${resourceId}`,
        nodeId: workspace?.activeNodeId ? String(workspace.activeNodeId) : null,
        branchId: workspace?.activeBranchId ? String(workspace.activeBranchId) : null,
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
