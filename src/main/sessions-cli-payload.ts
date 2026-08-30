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
import { resolveCliProjectPath } from './cli-project-path'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import {
  discoveryMode,
  nonNegativeInteger,
  positiveInteger,
  required,
  watchCursor,
} from './sessions-cli-arguments'
import { buildSessionsCliControlPayload } from './sessions-cli-control-payload'
import {
  buildSessionsCliExportOperationPayload,
  isSessionExportOperationCliCommand,
} from './sessions-cli-export-operation-payload'
import { buildSessionsCliExportPayload } from './sessions-cli-export-payload'
import {
  forkLifecyclePayload,
  rootLifecyclePayload,
  spawnLifecyclePayload,
} from './sessions-cli-lifecycle-payload'

const DEFAULT_SEARCH_LIMIT = 20
const REQUEST_RUN_POSITIONAL = 2
const REQUEST_INTERACTION_POSITIONAL = 3

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
  const condition = option(arguments_, 'condition') ?? 'idle'
  if (condition === 'state-revision-after') {
    const revision = nonNegativeInteger(
      required(option(arguments_, 'after-state-revision'), '--after-state-revision'),
      '--after-state-revision',
    )
    return arguments_.positionals.map((sessionId) => ({
      sessionId,
      condition: 'state-revision-after' as const,
      afterStateRevision: revision,
    }))
  }
  if (condition === 'queue-empty') {
    return arguments_.positionals.map((sessionId) => ({
      sessionId,
      condition: 'queue-empty' as const,
    }))
  }
  if (condition !== 'idle') throw new Error(`Unsupported wait condition: ${condition}.`)
  return arguments_.positionals.map((sessionId) => ({ sessionId, condition: 'idle' as const }))
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
  const sessionId = required(arguments_.positionals[0], 'Session ID')
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
  if (command !== 'items') throw new Error(`Unsupported Session query command: ${command}.`)
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'items',
        sessionId,
        ...(option(arguments_, 'run') ? { runId: option(arguments_, 'run') } : {}),
        limit: option(arguments_, 'limit')
          ? positiveInteger(option(arguments_, 'limit'), '--limit')
          : SESSION_QUERY_DISCOVERY_LIMIT,
        ...(option(arguments_, 'after')
          ? { afterCreatedOrder: nonNegativeInteger(option(arguments_, 'after'), '--after') }
          : {}),
      },
    },
  }
}

function queueListPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'queue-list',
        sessionId: required(arguments_.positionals[1], 'Session ID'),
        ...(hasFlag(arguments_, 'include-bodies') ? { includeBodies: true } : {}),
      },
    },
  }
}

function requestsPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const action = required(arguments_.positionals[0], 'Requests action')
  const sessionId = required(arguments_.positionals[1], 'Session ID')
  if (action === 'list') {
    return {
      contract: 'session-query-v2',
      request: {
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: randomUUID(),
        query: { operation: 'requests-list', sessionId },
      },
    }
  }
  if (action !== 'respond') throw new Error(`Unsupported requests action: ${action}.`)
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
        operation: hasFlag(arguments_, 'approve') ? 'approval-respond' : 'request-respond',
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

function isQueueListCommand(command: string, arguments_: ParsedArguments) {
  return command === 'queue' && arguments_.positionals[0] === 'list'
}

function exportPayload(arguments_: ParsedArguments) {
  return isSessionExportOperationCliCommand(arguments_.positionals[0])
    ? buildSessionsCliExportOperationPayload(arguments_)
    : buildSessionsCliExportPayload(arguments_)
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
    export: () => exportPayload(arguments_),
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
  if (isQueueListCommand(command, arguments_)) {
    return queueListPayload(arguments_)
  }
  if (command === 'requests') return requestsPayload(arguments_)
  return buildSessionsCliControlPayload(command, arguments_)
}

export const FULL_TRANSCRIPT_PAGE_LIMIT = SESSION_QUERY_TRANSCRIPT_LIMIT
