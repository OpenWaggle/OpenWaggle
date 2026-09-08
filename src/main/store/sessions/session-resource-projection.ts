import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { SessionNodeRow } from '../session-details'
import { runStoreEffect } from '../store-runtime'
import { buildSessionNodes } from './hydration'

const RESOURCE_NODE_QUERY_CHUNK_SIZE = 400
const RESOURCE_PROJECTION_MAX_PAGE_SIZE = 128
export const RESOURCE_PROJECTION_MAX_SERIALIZED_BYTES = 144 * 1024 * 1024

export interface SessionResourceProjectionCandidate {
  readonly id: string
  readonly created_order: number
  readonly payload_bytes: number
}

export function selectSessionResourceProjectionBatch(
  candidates: readonly SessionResourceProjectionCandidate[],
  limit: number,
) {
  const ids: string[] = []
  let serializedBytes = 0
  let processedCount = 0
  let throughCreatedOrder: number | null = null
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), RESOURCE_PROJECTION_MAX_PAGE_SIZE))

  for (const candidate of candidates.slice(0, boundedLimit)) {
    const validSize = Number.isSafeInteger(candidate.payload_bytes) && candidate.payload_bytes >= 0
    if (!validSize || candidate.payload_bytes > RESOURCE_PROJECTION_MAX_SERIALIZED_BYTES) {
      if (ids.length === 0) {
        throughCreatedOrder = candidate.created_order
        processedCount += 1
      }
      break
    }
    if (serializedBytes > RESOURCE_PROJECTION_MAX_SERIALIZED_BYTES - candidate.payload_bytes) break
    ids.push(candidate.id)
    serializedBytes += candidate.payload_bytes
    throughCreatedOrder = candidate.created_order
    processedCount += 1
  }

  return {
    ids,
    serializedBytes,
    throughCreatedOrder,
    hasMore: processedCount < candidates.length,
  }
}

const resourceNodeColumns = `
  id,
  session_id,
  parent_id,
  pi_entry_type,
  kind,
  role,
  timestamp_ms,
  content_json,
  metadata_json,
  branch_hint_id,
  path_depth,
  created_order
`

export async function getSessionResourceProjectionNodes(
  sessionId: SessionId,
  nodeIds: readonly string[],
) {
  if (nodeIds.length === 0) return []
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows: SessionNodeRow[] = []
      for (let index = 0; index < nodeIds.length; index += RESOURCE_NODE_QUERY_CHUNK_SIZE) {
        const chunk = nodeIds.slice(index, index + RESOURCE_NODE_QUERY_CHUNK_SIZE)
        const chunkRows = yield* sql<SessionNodeRow>`
          SELECT
            ${sql.unsafe(resourceNodeColumns)}
          FROM session_nodes
          WHERE session_id = ${sessionId}
            AND id IN ${sql.in(chunk)}
        `
        rows.push(...chunkRows)
      }
      rows.sort((left, right) => left.created_order - right.created_order)
      return buildSessionNodes(rows)
    }),
  )
}

export async function listSessionResourceProjectionPage(
  sessionId: SessionId,
  afterCreatedOrder: number,
  limit: number,
) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const boundedLimit = Math.max(
        1,
        Math.min(Math.floor(limit), RESOURCE_PROJECTION_MAX_PAGE_SIZE),
      )
      const candidates = yield* sql<SessionResourceProjectionCandidate>`
        SELECT
          id,
          created_order,
          COALESCE(length(CAST(content_json AS BLOB)), 0) +
            COALESCE(length(CAST(metadata_json AS BLOB)), 0) AS payload_bytes
        FROM session_nodes
        WHERE session_id = ${sessionId}
          AND created_order > ${afterCreatedOrder}
        ORDER BY created_order ASC
        LIMIT ${boundedLimit + 1}
      `
      const selection = selectSessionResourceProjectionBatch(candidates, boundedLimit)
      if (selection.ids.length === 0) {
        return {
          nodes: [],
          throughCreatedOrder: selection.throughCreatedOrder,
          hasMore: selection.hasMore,
        }
      }
      const rows = yield* sql<SessionNodeRow>`
        SELECT
          ${sql.unsafe(resourceNodeColumns)}
        FROM session_nodes
        WHERE session_id = ${sessionId}
          AND id IN ${sql.in(selection.ids)}
        ORDER BY created_order ASC
      `
      return {
        nodes: buildSessionNodes(rows),
        throughCreatedOrder: selection.throughCreatedOrder,
        hasMore: selection.hasMore,
      }
    }),
  )
}
