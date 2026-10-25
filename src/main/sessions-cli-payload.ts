import { randomUUID } from 'node:crypto'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentLoopResponseSchema } from '@shared/schemas/agent-loop-interaction'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import { sessionIdsFromReferences } from '@shared/utils/session-link'
import { resolveCliProjectPath } from './cli-project-path'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import {
  discoveryMode,
  nonNegativeInteger,
  positiveInteger,
  required,
  requiredSessionId,
  watchCursor,
} from './sessions-cli-arguments'
import { buildSessionsCliControlPayload } from './sessions-cli-control-payload'
import {
  buildDelegationQueryCliPayload,
  isDelegationQueryCliCommand,
} from './sessions-cli-delegations-payload'
import {
  buildSessionsCliExportOperationPayload,
  isSessionExportOperationCliCommand,
} from './sessions-cli-export-operation-payload'
import { buildSessionsCliExportPayload } from './sessions-cli-export-payload'
import { itemsPayload } from './sessions-cli-items-payload'
import {
  forkLifecyclePayload,
  rootLifecyclePayload,
  spawnLifecyclePayload,
} from './sessions-cli-lifecycle-payload'

const DEFAULT_SEARCH_LIMIT = 20
const REQUEST_RUN_POSITIONAL = 1
const REQUEST_INTERACTION_POSITIONAL = 2

function catalogPathScope(arguments_: ParsedArguments, workingDirectory: string) {
  if (hasFlag(arguments_, 'all')) return {}
  const project = option(arguments_, 'project')
  return project
    ? { projectPath: resolveCliProjectPath(project, workingDirectory) }
    : { workingPath: workingDirectory }
}

function listPayload(
  arguments_: ParsedArguments,
  workingDirectory: string,
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'list',
        limit: option(arguments_, 'limit')
          ? positiveInteger(option(arguments_, 'limit'), '--limit')
          : SESSION_QUERY_DISCOVERY_LIMIT,
        ...(option(arguments_, 'cursor') ? { cursor: option(arguments_, 'cursor') } : {}),
        ...(hasFlag(arguments_, 'archived') ? { archived: true } : {}),
        ...catalogPathScope(arguments_, workingDirectory),
      },
    },
  }
}

function searchPayload(
  arguments_: ParsedArguments,
  workingDirectory: string,
): LocalSessionCommandPayload {
  const mode = discoveryMode(option(arguments_, 'mode'))
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'search',
        query: required(arguments_.positionals.join(' '), 'Search query'),
        limit: option(arguments_, 'limit')
          ? positiveInteger(option(arguments_, 'limit'), '--limit')
          : DEFAULT_SEARCH_LIMIT,
        ...(option(arguments_, 'cursor') ? { cursor: option(arguments_, 'cursor') } : {}),
        ...catalogPathScope(arguments_, workingDirectory),
        ...(hasFlag(arguments_, 'include-archived') ? { includeArchived: true } : {}),
        ...(hasFlag(arguments_, 'full-transcript')
          ? { searchScope: 'full-transcript' as const }
          : {}),
        ...(mode ? { mode } : {}),
        ...(hasFlag(arguments_, 'require-fresh') ? { requireFresh: true } : {}),
        ...(option(arguments_, 'timeout-ms')
          ? { waitTimeoutMs: nonNegativeInteger(option(arguments_, 'timeout-ms'), '--timeout-ms') }
          : {}),
      },
    },
  }
}

function waitTargets(arguments_: ParsedArguments) {
  if (arguments_.positionals.length === 0) throw new Error('Session ID is required.')
  const sessionIds = sessionIdsFromReferences(arguments_.positionals, 'Session ID')
  const condition = option(arguments_, 'condition') ?? 'idle'
  if (condition === 'state-revision-after') {
    const revision = nonNegativeInteger(
      required(option(arguments_, 'after-state-revision'), '--after-state-revision'),
      '--after-state-revision',
    )
    return sessionIds.map((sessionId) => ({
      sessionId,
      condition: 'state-revision-after' as const,
      afterStateRevision: revision,
    }))
  }
  if (condition === 'queue-empty') {
    return sessionIds.map((sessionId) => ({
      sessionId,
      condition: 'queue-empty' as const,
    }))
  }
  if (condition === 'report-delivered') {
    const reportId = required(option(arguments_, 'report-id'), '--report-id')
    return sessionIds.map((sessionId) => ({
      sessionId,
      condition: 'report-delivered' as const,
      reportId,
    }))
  }
  if (condition === 'correlated-reply') {
    const correlationId = required(option(arguments_, 'correlation-id'), '--correlation-id')
    return sessionIds.map((sessionId) => ({
      sessionId,
      condition: 'correlated-reply' as const,
      correlationId,
    }))
  }
  if (condition !== 'idle') throw new Error(`Unsupported wait condition: ${condition}.`)
  return sessionIds.map((sessionId) => ({ sessionId, condition: 'idle' as const }))
}

function waitPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const after = watchCursor(arguments_)
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'wait',
        targets: waitTargets(arguments_),
        timeoutMs: nonNegativeInteger(option(arguments_, 'timeout-ms'), '--timeout-ms'),
        ...(after ? { after } : {}),
      },
    },
  }
}

function detailsPayload(command: string, arguments_: ParsedArguments): LocalSessionCommandPayload {
  if (command === 'items') return itemsPayload(arguments_)
  const sessionId = requiredSessionId(arguments_.positionals[0])
  if (command === 'turns') {
    return {
      contract: 'session-query-v2',
      request: {
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: randomUUID(),
        query: {
          operation: 'turns',
          sessionId,
          limit: option(arguments_, 'limit')
            ? positiveInteger(option(arguments_, 'limit'), '--limit')
            : SESSION_QUERY_DISCOVERY_LIMIT,
          ...(option(arguments_, 'cursor') ? { cursor: option(arguments_, 'cursor') } : {}),
        },
      },
    }
  }
  if (command === 'read' || command === 'status') {
    return {
      contract: 'session-query-v2',
      request: {
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: randomUUID(),
        query: { operation: command, sessionId },
      },
    }
  }
  throw new Error(`Unsupported Session query command: ${command}.`)
}

function queueListPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'queue-list',
        sessionId: requiredSessionId(arguments_.positionals[0]),
        ...(hasFlag(arguments_, 'include-bodies') ? { includeBodies: true } : {}),
      },
    },
  }
}

function requestsPayload(command: string, arguments_: ParsedArguments): LocalSessionCommandPayload {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  if (command === 'requests-list') {
    return {
      contract: 'session-query-v2',
      request: {
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: randomUUID(),
        query: { operation: 'requests-list', sessionId },
      },
    }
  }
  if (command !== 'request-respond' && command !== 'approval-respond') {
    throw new Error(`Unsupported requests command: ${command}.`)
  }
  const response = decodeUnknownExactOrThrow(
    agentLoopResponseSchema,
    JSON.parse(required(option(arguments_, 'response-json'), '--response-json')),
  )
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: option(arguments_, 'idempotency-key') ?? randomUUID(),
      command: {
        operation: command,
        sessionId,
        runId: required(arguments_.positionals[REQUEST_RUN_POSITIONAL], 'Run ID'),
        interactionId: required(
          arguments_.positionals[REQUEST_INTERACTION_POSITIONAL],
          'Interaction ID',
        ),
        kind: response.kind,
        response,
      },
    },
  }
}

function directSessionsCliPayload(
  command: string,
  arguments_: ParsedArguments,
  workingDirectory: string,
) {
  const builders: Readonly<Record<string, () => LocalSessionCommandPayload>> = {
    list: () => listPayload(arguments_, workingDirectory),
    search: () => searchPayload(arguments_, workingDirectory),
    wait: () => waitPayload(arguments_),
    export: () => buildSessionsCliExportPayload(arguments_),
    create: () => rootLifecyclePayload('create', arguments_, workingDirectory),
    launch: () => rootLifecyclePayload('launch', arguments_, workingDirectory),
    fork: () => forkLifecyclePayload(arguments_),
    spawn: () => spawnLifecyclePayload(arguments_),
  }
  return builders[command]?.()
}

export function buildSessionsCliPayload(
  command: string,
  arguments_: ParsedArguments,
  context: { readonly workingDirectory?: string } = {},
): LocalSessionCommandPayload {
  const workingDirectory = context.workingDirectory ?? process.cwd()
  const direct = directSessionsCliPayload(command, arguments_, workingDirectory)
  if (direct) return direct
  if (command === 'read' || command === 'turns' || command === 'items' || command === 'status') {
    return detailsPayload(command, arguments_)
  }
  if (command === 'queue-list') return queueListPayload(arguments_)
  if (
    command === 'requests-list' ||
    command === 'request-respond' ||
    command === 'approval-respond'
  ) {
    return requestsPayload(command, arguments_)
  }
  if (isSessionExportOperationCliCommand(command)) {
    return buildSessionsCliExportOperationPayload(command, arguments_)
  }
  if (isDelegationQueryCliCommand(command)) {
    return buildDelegationQueryCliPayload(command, arguments_, { workingDirectory })
  }
  return buildSessionsCliControlPayload(command, arguments_)
}

export const FULL_TRANSCRIPT_PAGE_LIMIT = SESSION_QUERY_TRANSCRIPT_LIMIT
