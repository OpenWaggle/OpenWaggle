import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import {
  buildSessionsToolCollaborationPayload,
  isSessionsToolCollaborationAction,
} from './sessions-tool-collaboration-payload'
import {
  buildSessionsToolControlPayload,
  isSessionsToolControlAction,
} from './sessions-tool-control-payload'
import {
  buildSessionsToolExportOperationPayload,
  isSessionsToolExportOperation,
} from './sessions-tool-export-operation-payload'
import { buildSessionsToolExportPayload } from './sessions-tool-export-payload'
import {
  buildSessionsToolLifecyclePayload,
  isSessionsToolLifecycleAction,
} from './sessions-tool-lifecycle-payload'
import {
  buildSessionsToolOrganizationPayload,
  isSessionsToolOrganization,
} from './sessions-tool-organization-payload'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import {
  buildSessionsToolQueuePayload,
  isSessionsToolQueueAction,
} from './sessions-tool-queue-payload'
import { buildSessionsToolWaitPayload } from './sessions-tool-wait-payload'

const DEFAULT_LIST_LIMIT = 50
const DEFAULT_SEARCH_LIMIT = 20

export interface SessionsToolSource {
  readonly sessionId: string
  readonly runId: string
  readonly workingDirectory?: string
  readonly projectPath?: string
}

function catalogFilter(
  input: Extract<SessionsToolParameters, { action: 'list' | 'search' }>,
  source: SessionsToolSource,
) {
  const catalogScope = input.catalogScope ?? 'current'
  if (catalogScope === 'all') return {}
  if (catalogScope === 'project' && input.projectPath) return { projectPath: input.projectPath }
  return { workingPath: source.workingDirectory ?? process.cwd() }
}

function catalogPayload(
  input: Extract<SessionsToolParameters, { action: 'list' | 'search' }>,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  const filter = catalogFilter(input, source)
  const query =
    input.action === 'list'
      ? {
          operation: 'list' as const,
          limit: input.limit ?? DEFAULT_LIST_LIMIT,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...filter,
          ...(input.archived === undefined ? {} : { archived: input.archived }),
        }
      : {
          operation: 'search' as const,
          query: input.query,
          limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.fullTranscript ? { searchScope: 'full-transcript' as const } : {}),
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.requireFresh ? { requireFresh: true } : {}),
          ...(input.waitTimeoutMs === undefined ? {} : { waitTimeoutMs: input.waitTimeoutMs }),
          ...filter,
        }
  return {
    contract: 'session-query-v2',
    request: { contractVersion: SESSION_QUERY_CONTRACT_VERSION, requestId: randomUUID(), query },
  }
}

function readPayload(
  input: Extract<
    SessionsToolParameters,
    { action: 'read' | 'turns' | 'status' | 'queue_list' | 'requests_list' }
  >,
): LocalSessionCommandPayload {
  const query =
    input.action === 'queue_list'
      ? {
          operation: 'queue-list' as const,
          sessionId: input.sessionId,
          ...(input.includeBodies ? { includeBodies: true } : {}),
        }
      : input.action === 'requests_list'
        ? { operation: 'requests-list' as const, sessionId: input.sessionId }
        : input.action === 'turns'
          ? {
              operation: 'turns' as const,
              sessionId: input.sessionId,
              limit: input.limit ?? DEFAULT_LIST_LIMIT,
              ...(input.cursor ? { cursor: input.cursor } : {}),
            }
          : { operation: input.action, sessionId: input.sessionId }
  return {
    contract: 'session-query-v2',
    request: { contractVersion: SESSION_QUERY_CONTRACT_VERSION, requestId: randomUUID(), query },
  }
}

function itemsPayload(
  input: Extract<SessionsToolParameters, { action: 'items' }>,
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'items',
        sessionId: input.sessionId,
        ...(input.runId ? { runId: input.runId } : {}),
        limit:
          input.limit ?? Math.min(SESSION_QUERY_DISCOVERY_LIMIT, SESSION_QUERY_TRANSCRIPT_LIMIT),
        ...(input.afterCreatedOrder === undefined
          ? {}
          : { afterCreatedOrder: input.afterCreatedOrder }),
        ...(input.throughCreatedOrder === undefined
          ? {}
          : { throughCreatedOrder: input.throughCreatedOrder }),
      },
    },
  }
}

type DelegationListInput = Extract<SessionsToolParameters, { action: 'delegations_list' }>
type DelegationConflictsInput = Extract<SessionsToolParameters, { action: 'delegations_conflicts' }>

function delegationCatalogFilter(
  input: DelegationListInput | DelegationConflictsInput,
  source: SessionsToolSource,
) {
  if (input.catalogScope === 'all') return {}
  return input.catalogScope === 'project' && input.projectPath
    ? { projectPath: input.projectPath }
    : { workingPath: source.workingDirectory ?? process.cwd() }
}

function delegationListQuery(input: DelegationListInput, source: SessionsToolSource) {
  return {
    operation: 'delegations-list' as const,
    limit: input.limit ?? DEFAULT_LIST_LIMIT,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...delegationCatalogFilter(input, source),
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.workerSessionId ? { workerSessionId: input.workerSessionId } : {}),
    ...(input.states ? { states: input.states } : {}),
  }
}

function delegationConflictsQuery(input: DelegationConflictsInput, source: SessionsToolSource) {
  return {
    operation: 'delegations-conflicts' as const,
    limit: input.limit ?? DEFAULT_LIST_LIMIT,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...delegationCatalogFilter(input, source),
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.workerSessionId ? { workerSessionId: input.workerSessionId } : {}),
    ...(input.delegationId ? { delegationId: input.delegationId } : {}),
    ...(input.kinds ? { kinds: input.kinds } : {}),
    ...(input.statuses ? { statuses: input.statuses } : {}),
  }
}

function delegationQueryPayload(
  input: Extract<
    SessionsToolParameters,
    { action: 'delegations_list' | 'delegations_read' | 'delegations_conflicts' }
  >,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  const query =
    input.action === 'delegations_read'
      ? { operation: 'delegations-read' as const, delegationId: input.delegationId }
      : input.action === 'delegations_conflicts'
        ? delegationConflictsQuery(input, source)
        : delegationListQuery(input, source)
  return {
    contract: 'session-query-v2',
    request: { contractVersion: SESSION_QUERY_CONTRACT_VERSION, requestId: randomUUID(), query },
  }
}

function isDelegationQueryAction(
  input: SessionsToolParameters,
): input is Extract<
  SessionsToolParameters,
  { action: 'delegations_list' | 'delegations_read' | 'delegations_conflicts' }
> {
  return (
    input.action === 'delegations_list' ||
    input.action === 'delegations_read' ||
    input.action === 'delegations_conflicts'
  )
}

function basicReadPayload(input: SessionsToolParameters) {
  if (
    input.action !== 'read' &&
    input.action !== 'turns' &&
    input.action !== 'status' &&
    input.action !== 'queue_list' &&
    input.action !== 'requests_list'
  ) {
    return undefined
  }
  return readPayload(input)
}

export function buildSessionsToolPayload(
  input: SessionsToolParameters,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  if (isSessionsToolLifecycleAction(input)) {
    return buildSessionsToolLifecyclePayload(input, source)
  }
  if (input.action === 'list' || input.action === 'search') return catalogPayload(input, source)
  const basicRead = basicReadPayload(input)
  if (basicRead) return basicRead
  if (input.action === 'items') return itemsPayload(input)
  if (input.action === 'export') return buildSessionsToolExportPayload(input)
  if (isSessionsToolExportOperation(input)) {
    return buildSessionsToolExportOperationPayload(input, source)
  }
  if (isSessionsToolOrganization(input)) return buildSessionsToolOrganizationPayload(input)
  if (isDelegationQueryAction(input)) {
    return delegationQueryPayload(input, source)
  }
  if (input.action === 'wait') return buildSessionsToolWaitPayload(input)
  if (isSessionsToolQueueAction(input)) return buildSessionsToolQueuePayload(input)
  if (isSessionsToolCollaborationAction(input)) {
    return buildSessionsToolCollaborationPayload(input, source)
  }
  if (isSessionsToolControlAction(input)) return buildSessionsToolControlPayload(input)
  throw new Error(`Unsupported Sessions tool action: ${input.action}`)
}
