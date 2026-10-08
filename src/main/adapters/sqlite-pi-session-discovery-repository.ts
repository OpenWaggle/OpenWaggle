import { SessionId } from '@shared/types/brand'
import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import {
  PiSessionDiscoveryRepository,
  type PiSessionDiscoveryRepositoryShape,
} from '../ports/pi-session-discovery'
import {
  SessionTranscriptRepair,
  type SessionTranscriptRepairShape,
} from '../ports/session-transcript-repair'
import { recordUnchangedPiProjection } from '../store/pi-session-file-freshness'
import {
  type ExternalSnapshotEntryIdRepair,
  persistExternalPiSnapshot,
} from '../store/session-details/persist-external-pi-snapshot'
import {
  adoptDiscoveredPiSession,
  getPiSessionProjectionState,
  listUnattachedDiscoveredPiSessions,
  readPiSessionDiscoveryScope,
} from '../store/session-details/pi-session-discovery-store'

function repositoryOperation<T>(operation: string, task: () => Promise<T>) {
  return Effect.tryPromise({
    try: task,
    catch: (cause) => new SessionProjectionRepositoryError({ operation, cause }),
  })
}

/**
 * The discovery repository. An external projection renames Pi entries whose ids another Session
 * holds through the transcript repair, as a Run's snapshot does (ADR 0049).
 */
function createPiSessionDiscoveryRepository(
  transcriptRepair: SessionTranscriptRepairShape,
): PiSessionDiscoveryRepositoryShape {
  const repairEntryIds: ExternalSnapshotEntryIdRepair = (input, foreignNodeIds) =>
    Effect.runPromise(transcriptRepair.renameForeignEntryIds(input, foreignNodeIds))
  return {
    readScope: () =>
      repositoryOperation('readPiSessionDiscoveryScope', readPiSessionDiscoveryScope),
    adoptDiscovered: (input) =>
      repositoryOperation('adoptDiscoveredPiSession', () => adoptDiscoveredPiSession(input)),
    listUnattachedDiscoveredSessions: () =>
      repositoryOperation('listUnattachedDiscoveredPiSessions', listUnattachedDiscoveredPiSessions),
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
        persistExternalPiSnapshot(
          {
            sessionId: SessionId(String(input.sessionId)),
            nodes: input.sessionSnapshot.nodes,
            activeNodeId: input.sessionSnapshot.activeNodeId,
            piSessionId: input.piSessionId,
            piSessionFile: input.piSessionFile,
            expectedRevision: input.expectedRevision,
            fingerprint: input.fingerprint,
          },
          repairEntryIds,
        ),
      ),
  }
}

export const SqlitePiSessionDiscoveryRepositoryLive = Layer.effect(
  PiSessionDiscoveryRepository,
  Effect.map(SessionTranscriptRepair, createPiSessionDiscoveryRepository),
)
