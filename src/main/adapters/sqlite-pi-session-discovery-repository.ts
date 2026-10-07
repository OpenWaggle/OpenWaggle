import { SessionId } from '@shared/types/brand'
import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import {
  PiSessionDiscoveryRepository,
  type PiSessionDiscoveryRepositoryShape,
} from '../ports/pi-session-discovery'
import { recordUnchangedPiProjection } from '../store/pi-session-file-freshness'
import { persistExternalPiSnapshot } from '../store/session-details/persist-external-pi-snapshot'
import {
  adoptDiscoveredPiSession,
  getPiSessionProjectionState,
  readPiSessionDiscoveryScope,
} from '../store/session-details/pi-session-discovery-store'

function repositoryOperation<T>(operation: string, task: () => Promise<T>) {
  return Effect.tryPromise({
    try: task,
    catch: (cause) => new SessionProjectionRepositoryError({ operation, cause }),
  })
}

export const SqlitePiSessionDiscoveryRepositoryLive = Layer.succeed(PiSessionDiscoveryRepository, {
  readScope: () => repositoryOperation('readPiSessionDiscoveryScope', readPiSessionDiscoveryScope),
  adoptDiscovered: (input) =>
    repositoryOperation('adoptDiscoveredPiSession', () => adoptDiscoveredPiSession(input)),
  getProjectionState: (sessionId) =>
    repositoryOperation('getPiSessionProjectionState', () =>
      getPiSessionProjectionState(sessionId),
    ),
  recordUnchanged: ({ sessionId, expectedRevision, fingerprint }) =>
    repositoryOperation('recordUnchangedPiProjection', () =>
      recordUnchangedPiProjection(sessionId, expectedRevision, fingerprint),
    ),
  persistExternal: (input) =>
    repositoryOperation('persistExternalPiSnapshot', () =>
      persistExternalPiSnapshot({
        sessionId: SessionId(String(input.sessionId)),
        nodes: input.sessionSnapshot.nodes,
        activeNodeId: input.sessionSnapshot.activeNodeId,
        piSessionId: input.piSessionId,
        piSessionFile: input.piSessionFile,
        expectedRevision: input.expectedRevision,
        fingerprint: input.fingerprint,
      }),
    ),
} satisfies PiSessionDiscoveryRepositoryShape)
