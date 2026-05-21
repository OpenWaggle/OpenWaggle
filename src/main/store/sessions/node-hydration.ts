import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { isRecord } from '@shared/utils/validation'
import {
  hydrateSessionMessage,
  hydrateStructuralSessionMessage,
  type SessionNodeRow,
} from '../session-details'
import { CUSTOM_MESSAGE_ENTRY_TYPE, MESSAGE_ENTRY_TYPE } from './constants'
import { parseJson } from './json'

export function buildSessionNodes(nodeRows: readonly SessionNodeRow[]) {
  const visibleParentById = buildVisibleParentByRowId(nodeRows)
  const visibleDepthById = new Map<string, number>()

  return nodeRows
    .filter((row) => !isHiddenCustomMessageRow(row))
    .map((row) => hydrateSessionNode(row, visibleParentById, visibleDepthById))
}

function isHiddenCustomMessageRow(row: SessionNodeRow) {
  if (row.pi_entry_type !== CUSTOM_MESSAGE_ENTRY_TYPE) return false
  const metadata = parseJson(row.metadata_json, `node:${row.id}:metadata`)
  return isRecord(metadata) && metadata.display === false
}

function buildVisibleParentByRowId(rows: readonly SessionNodeRow[]) {
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const visibleParentById = new Map<string, string | null>()

  for (const row of rows) {
    if (!isHiddenCustomMessageRow(row)) {
      visibleParentById.set(row.id, findVisibleParentId(row.parent_id, rowById))
    }
  }
  return visibleParentById
}

function findVisibleParentId(
  parentId: string | null,
  rowById: ReadonlyMap<string, SessionNodeRow>,
) {
  let currentParentId = parentId
  while (currentParentId) {
    const parent = rowById.get(currentParentId)
    if (!parent) return null
    if (!isHiddenCustomMessageRow(parent)) return currentParentId
    currentParentId = parent.parent_id
  }
  return null
}

function getVisiblePathDepth(
  rowId: string,
  visibleParentById: ReadonlyMap<string, string | null>,
  depthById: Map<string, number>,
): number {
  const cached = depthById.get(rowId)
  if (cached !== undefined) return cached

  const parentId = visibleParentById.get(rowId) ?? null
  const depth = parentId ? getVisiblePathDepth(parentId, visibleParentById, depthById) + 1 : 0
  depthById.set(rowId, depth)
  return depth
}

function hydrateSessionNode(
  row: SessionNodeRow,
  visibleParentById: ReadonlyMap<string, string | null>,
  visibleDepthById: Map<string, number>,
) {
  const parentId = visibleParentById.get(row.id) ?? null
  return {
    id: SessionNodeId(row.id),
    sessionId: SessionId(row.session_id),
    parentId: parentId ? SessionNodeId(parentId) : null,
    piEntryType: row.pi_entry_type,
    kind: row.kind,
    role: row.role ?? undefined,
    timestampMs: row.timestamp_ms,
    createdOrder: row.created_order,
    pathDepth: getVisiblePathDepth(row.id, visibleParentById, visibleDepthById),
    branchId: row.branch_hint_id ? SessionBranchId(row.branch_hint_id) : null,
    message: hydrateNodeMessage(row),
    contentJson: row.content_json,
    metadataJson: row.metadata_json,
  }
}

function hydrateNodeMessage(row: SessionNodeRow) {
  if (
    row.role !== null &&
    (row.pi_entry_type === MESSAGE_ENTRY_TYPE ||
      row.kind === 'user_message' ||
      row.kind === 'assistant_message')
  ) {
    return hydrateSessionMessage(row)
  }
  return hydrateStructuralSessionMessage(row) ?? undefined
}
