import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_EXPORT_OPERATION_QUERY_LIMIT } from '@shared/types/session-export-operation'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import type { SessionsToolSource } from './sessions-tool-payload'

type ExportOperationInput = Extract<
  SessionsToolParameters,
  {
    action: 'export_create' | 'export_cancel' | 'exports_list' | 'exports_read' | 'exports_wait'
  }
>

function destinationPath(input: string, source: SessionsToolSource) {
  const workspace = path.resolve(source.workingDirectory ?? process.cwd())
  const destination = path.resolve(workspace, input)
  const relative = path.relative(workspace, destination)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('sessions export_create destinationPath must stay inside this workspace.')
  }
  return destination
}

function exportControlPayload(
  input: Extract<ExportOperationInput, { action: 'export_create' | 'export_cancel' }>,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  const base = {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: randomUUID(),
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
  }
  if (input.action === 'export_cancel') {
    return {
      contract: 'session-control-v2',
      request: {
        ...base,
        command: {
          operation: 'export-cancel' as const,
          sessionId: input.sessionId,
          exportOperationId: input.exportOperationId,
        },
      },
    }
  }
  return {
    contract: 'session-control-v2',
    request: {
      ...base,
      command: {
        operation: 'export-create' as const,
        sessionId: input.sessionId,
        format: input.format ?? 'jsonl',
        destinationPath: destinationPath(input.destinationPath, source),
        branchScope: input.branchScope ?? 'active-branch',
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.includeQueueBodies ? { includeQueueBodies: true } : {}),
        ...(input.overwriteExisting ? { overwriteExisting: true } : {}),
        ...(input.resources?.length
          ? {
              resources: input.resources.map((resourcePath) => ({
                kind: 'workspace-file' as const,
                path: resourcePath,
              })),
            }
          : {}),
      },
    },
  }
}

function exportQueryPayload(
  input: Extract<
    ExportOperationInput,
    { action: 'exports_list' | 'exports_read' | 'exports_wait' }
  >,
): LocalSessionCommandPayload {
  const query =
    input.action === 'exports_list'
      ? {
          operation: 'exports-list' as const,
          sessionId: input.sessionId,
          limit: input.limit ?? SESSION_EXPORT_OPERATION_QUERY_LIMIT,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.statuses?.length ? { statuses: input.statuses } : {}),
        }
      : input.action === 'exports_read'
        ? {
            operation: 'exports-read' as const,
            sessionId: input.sessionId,
            exportOperationId: input.exportOperationId,
          }
        : {
            operation: 'exports-wait' as const,
            sessionId: input.sessionId,
            exportOperationId: input.exportOperationId,
            timeoutMs: input.timeoutMs,
            ...(input.after ? { after: input.after } : {}),
          }
  return {
    contract: 'session-query-v2',
    request: { contractVersion: SESSION_QUERY_CONTRACT_VERSION, requestId: randomUUID(), query },
  }
}

export function isSessionsToolExportOperation(
  input: SessionsToolParameters,
): input is ExportOperationInput {
  return new Set([
    'export_create',
    'export_cancel',
    'exports_list',
    'exports_read',
    'exports_wait',
  ]).has(input.action)
}

export function buildSessionsToolExportOperationPayload(
  input: ExportOperationInput,
  source: SessionsToolSource,
) {
  return input.action === 'export_create' || input.action === 'export_cancel'
    ? exportControlPayload(input, source)
    : exportQueryPayload(input)
}
