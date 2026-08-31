import { randomUUID } from 'node:crypto'
import path from 'node:path'
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
  watchCursor,
} from './sessions-cli-arguments'

const EXPORT_TARGET_POSITION = 2

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
  return requested.map((status) => {
    const resolved = SESSION_EXPORT_OPERATION_STATUSES.find((candidate) => candidate === status)
    if (!resolved) throw new Error(`Unsupported export status: ${status}.`)
    return resolved
  })
}

function createPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const scope = option(arguments_, 'scope') ?? 'active-branch'
  if (scope !== 'active-branch' && scope !== 'tree') {
    throw new Error('Unsupported export scope. Expected active-branch or tree.')
  }
  return {
    contract: 'session-control-v2',
    request: {
      ...controlRequest(arguments_),
      command: {
        operation: 'export-create',
        sessionId: required(arguments_.positionals[1], 'Session ID'),
        format: exportFormat(option(arguments_, 'format')),
        destinationPath: path.resolve(
          required(arguments_.positionals[EXPORT_TARGET_POSITION], 'Destination path'),
        ),
        branchScope: scope,
        ...(option(arguments_, 'branch') ? { branchId: option(arguments_, 'branch') } : {}),
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
        sessionId: required(arguments_.positionals[1], 'Session ID'),
        exportOperationId: required(
          arguments_.positionals[EXPORT_TARGET_POSITION],
          'Export operation ID',
        ),
      },
    },
  }
}

function queryPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const subcommand = required(arguments_.positionals[0], 'Export operation command')
  const sessionId = required(arguments_.positionals[1], 'Session ID')
  const base = {
    contract: 'session-query-v2' as const,
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
    },
  }
  if (subcommand === 'list') {
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
        },
      },
    }
  }
  const exportOperationId = required(
    arguments_.positionals[EXPORT_TARGET_POSITION],
    'Export operation ID',
  )
  if (subcommand === 'read') {
    return {
      ...base,
      request: {
        ...base.request,
        query: { operation: 'exports-read', sessionId, exportOperationId },
      },
    }
  }
  if (subcommand === 'wait') {
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
        },
      },
    }
  }
  throw new Error(`Unsupported export operation command: ${subcommand}.`)
}

export const SESSION_EXPORT_OPERATION_CLI_COMMANDS = [
  'create',
  'cancel',
  'list',
  'read',
  'wait',
  'watch',
] as const

export function isSessionExportOperationCliCommand(value: string | undefined) {
  return SESSION_EXPORT_OPERATION_CLI_COMMANDS.some((candidate) => candidate === value)
}

export function buildSessionsCliExportOperationPayload(
  arguments_: ParsedArguments,
): LocalSessionCommandPayload {
  const subcommand = arguments_.positionals[0]
  if (subcommand === 'create') return createPayload(arguments_)
  if (subcommand === 'cancel') return cancelPayload(arguments_)
  return queryPayload(arguments_)
}
