import { SESSION_EXPORT_SCHEMA_VERSION } from '@shared/types/session-export'
import { parseSessionJson } from './sqlite-session-query-support'

export interface ExportNodeRow {
  readonly id: string
  readonly parent_id: string | null
  readonly branch_hint_id: string | null
  readonly role: string | null
  readonly kind: string
  readonly timestamp_ms: number
  readonly created_order: number
  readonly content_json: string
  readonly metadata_json: string
}

function runIdFromMetadata(metadata: unknown) {
  if (typeof metadata !== 'object' || metadata === null || !('openWaggle' in metadata)) {
    return undefined
  }
  const openWaggle = metadata.openWaggle
  if (typeof openWaggle !== 'object' || openWaggle === null || !('runId' in openWaggle)) {
    return undefined
  }
  return typeof openWaggle.runId === 'string' ? openWaggle.runId : undefined
}

export function exportNodeRecord(sessionId: string, row: ExportNodeRow) {
  const metadata = parseSessionJson(row.metadata_json)
  const runId = runIdFromMetadata(metadata)
  return {
    record: 'node' as const,
    schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
    sessionId,
    nodeId: row.id,
    parentNodeId: row.parent_id,
    branchHintId: row.branch_hint_id,
    role: row.role,
    kind: row.kind,
    timestampMs: row.timestamp_ms,
    createdOrder: row.created_order,
    ...(runId ? { runId } : {}),
    content: parseSessionJson(row.content_json),
    metadata,
  }
}
