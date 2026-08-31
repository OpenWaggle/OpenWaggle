import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import type { SessionsToolParameters } from './sessions-tool-parameters'

export function buildSessionsToolExportPayload(
  input: Extract<SessionsToolParameters, { action: 'export' }>,
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'export',
        sessionId: input.sessionId,
        branchScope: input.branchScope ?? 'active-branch',
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.includeQueueBodies ? { includeQueueBodies: true } : {}),
        limit: input.limit ?? SESSION_QUERY_TRANSCRIPT_LIMIT,
        ...(input.afterCreatedOrder === undefined
          ? {}
          : { afterCreatedOrder: input.afterCreatedOrder }),
        ...(input.throughCreatedOrder === undefined
          ? {}
          : { throughCreatedOrder: input.throughCreatedOrder }),
        ...(input.snapshotStateRevision === undefined
          ? {}
          : { snapshotStateRevision: input.snapshotStateRevision }),
        ...(input.capturedAt === undefined ? {} : { capturedAt: input.capturedAt }),
      },
    },
  }
}
