import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { assertSessionExportBranchSelection } from '@shared/session-export-selection'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import {
  SESSION_EXPORT_FORMATS,
  SESSION_EXPORT_OPERATION_QUERY_LIMIT,
  SESSION_EXPORT_OPERATION_STATUSES,
} from '@shared/types/session-export-operation'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import {
  nonNegativeInteger,
  positiveInteger,
  required,
  requiredSessionId,
  watchCursor,
} from './sessions-cli-arguments'

const EXPORT_TARGET_POSITION = 1

function controlRequest(arguments_: ParsedArguments) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: randomUUID(),
    idempotencyKey: option(arguments_, 'idempotency-key') ?? randomUUID(),
  }
}

function exportFormat(value: string | undefined) {
  const format = value ?? 'jsonl'
  const resolved = SESSION_EXPORT_FORMATS.find((candidate) => candidate === format)
  if (!resolved) throw new Error(`Unsupported export format: ${format}.`)
  return resolved
}

function exportStatuses(arguments_: ParsedArguments) {
  const requested = arguments_.options.get('status') ?? []
  return [
    ...new Set(
      requested.map((status) => {
        const resolved = SESSION_EXPORT_OPERATION_STATUSES.find((candidate) => candidate === status)
        if (!resolved) throw new Error(`Unsupported export status: ${status}.`)
        return resolved
      }),
    ),
  ]
}

function createPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const scope = option(arguments_, 'scope') ?? 'active-branch'
  if (scope !== 'active-branch' && scope !== 'tree') {
    throw new Error('Unsupported export scope. Expected active-branch or tree.')
  }
  const branchId = option(arguments_, 'branch')
  assertSessionExportBranchSelection({ branchScope: scope, ...(branchId ? { branchId } : {}) })
  return {
    contract: 'session-control-v2',
    request: {
      ...controlRequest(arguments_),
      command: {
        operation: 'export-create',
        sessionId: requiredSessionId(arguments_.positionals[0]),
        format: exportFormat(option(arguments_, 'format')),
        destinationPath: path.resolve(
          required(arguments_.positionals[EXPORT_TARGET_POSITION], 'Destination path'),
        ),
        branchScope: scope,
        ...(branchId ? { branchId } : {}),
        ...(hasFlag(arguments_, 'overwrite') ? { overwriteExisting: true } : {}),
        ...(hasFlag(arguments_, 'include-queue-bodies') ? { includeQueueBodies: true } : {}),
        ...(arguments_.options.get('resource')?.length
          ? {
              resources: arguments_.options
                .get('resource')
                ?.map((path) => ({ kind: 'workspace-file' as const, path })),
            }
          : {}),
      },
    },
  }
}

function cancelPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    request: {
      ...controlRequest(arguments_),
      command: {
        operation: 'export-cancel',
        sessionId: requiredSessionId(arguments_.positionals[0]),
        exportOperationId: required(
          arguments_.positionals[EXPORT_TARGET_POSITION],
          'Export operation ID',
        ),
      },
    },
  }
}

function queryPayload(command: string, arguments_: ParsedArguments): LocalSessionCommandPayload {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  const base = {
    contract: 'session-query-v2' as const,
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
    },
  }
  if (command === 'exports-list') {
    const statuses = exportStatuses(arguments_)
    return {
      ...base,
      request: {
        ...base.request,
        query: {
          operation: 'exports-list',
          sessionId,
          limit: option(arguments_, 'limit')
            ? positiveInteger(option(arguments_, 'limit'), '--limit')
            : SESSION_EXPORT_OPERATION_QUERY_LIMIT,
          ...(option(arguments_, 'cursor') ? { cursor: option(arguments_, 'cursor') } : {}),
          ...(statuses.length ? { statuses } : {}),
          ...(hasFlag(arguments_, 'include-queue-bodies') ? { includeQueueBodies: true } : {}),
        },
      },
    }
  }
  const exportOperationId = required(
    arguments_.positionals[EXPORT_TARGET_POSITION],
    'Export operation ID',
  )
  if (command === 'exports-read') {
    return {
      ...base,
      request: {
        ...base.request,
        query: {
          operation: 'exports-read',
          sessionId,
          exportOperationId,
          ...(hasFlag(arguments_, 'include-queue-bodies') ? { includeQueueBodies: true } : {}),
        },
      },
    }
  }
  if (command === 'exports-wait') {
    const after = watchCursor(arguments_)
    return {
      ...base,
      request: {
        ...base.request,
        query: {
          operation: 'exports-wait',
          sessionId,
          exportOperationId,
          timeoutMs: nonNegativeInteger(option(arguments_, 'timeout-ms'), '--timeout-ms'),
          ...(after ? { after } : {}),
          ...(hasFlag(arguments_, 'include-queue-bodies') ? { includeQueueBodies: true } : {}),
        },
      },
    }
  }
  throw new Error(`Unsupported export operation command: ${command}.`)
}

/** The Hive subcommands over durable export operations; `exports-watch` streams their events. */
export const SESSION_EXPORT_OPERATION_CLI_COMMANDS = [
  'export-create',
  'export-cancel',
  'exports-list',
  'exports-read',
  'exports-wait',
  'exports-watch',
] as const

export function isSessionExportOperationCliCommand(value: string | undefined) {
  return SESSION_EXPORT_OPERATION_CLI_COMMANDS.some((candidate) => candidate === value)
}

export function buildSessionsCliExportOperationPayload(
  command: string,
  arguments_: ParsedArguments,
): LocalSessionCommandPayload {
  if (command === 'export-create') return createPayload(arguments_)
  if (command === 'export-cancel') return cancelPayload(arguments_)
  return queryPayload(command, arguments_)
}
