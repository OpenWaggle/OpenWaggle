import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type ExportSelectedPathSnapshotIdentity,
  SESSION_EXPORT_SELECTED_PATH_CACHE_NODE_LIMIT,
  type SessionExportSelectedPathCache,
} from './session-export-selected-path-cache'
import type { exportNodeReadStrategy } from './sqlite-session-export-node-reader'
import {
  ensureMaterializedExportSelectedPath,
  readExportSelectedPathCreatedOrders,
} from './sqlite-session-export-selected-path'

interface ExportSelectedPathReadInput {
  readonly readStrategy: ReturnType<typeof exportNodeReadStrategy>
  readonly exportOperationId: string | undefined
  readonly sessionId: string
  readonly selectedBranchId: string | null
  readonly selectedHeadNodeId: string | null
  readonly nodeMutationRevision: number
  readonly afterCreatedOrder: number
  readonly throughCreatedOrder: number
  readonly limit: number
}

const NO_PREPARED_EXPORT_SELECTED_PATH = {}

export function prepareExportSelectedPath(
  sql: SqlClient.SqlClient,
  cache: SessionExportSelectedPathCache,
  input: ExportSelectedPathReadInput,
) {
  return Effect.gen(function* () {
    if (
      input.readStrategy !== 'recursive-branch' ||
      !input.selectedBranchId ||
      !input.selectedHeadNodeId
    ) {
      return NO_PREPARED_EXPORT_SELECTED_PATH
    }
    if (input.exportOperationId) {
      yield* ensureMaterializedExportSelectedPath(
        sql,
        {
          exportOperationId: input.exportOperationId,
          sessionId: input.sessionId,
          selectedBranchId: input.selectedBranchId,
          selectedHeadNodeId: input.selectedHeadNodeId,
          nodeMutationRevision: input.nodeMutationRevision,
        },
        Date.now(),
      )
      return { materializedExportOperationId: input.exportOperationId }
    }

    const identity: ExportSelectedPathSnapshotIdentity = {
      sessionId: input.sessionId,
      selectedBranchId: input.selectedBranchId,
      selectedHeadNodeId: input.selectedHeadNodeId,
      nodeMutationRevision: input.nodeMutationRevision,
    }
    if (cache.wasRejected(identity)) return NO_PREPARED_EXPORT_SELECTED_PATH
    const pageInput = {
      afterCreatedOrder: input.afterCreatedOrder,
      throughCreatedOrder: input.throughCreatedOrder,
      limit: input.limit + 1,
    }
    const cached = cache.readPage(identity, pageInput)
    if (cached !== undefined) return { selectedPathCreatedOrders: cached }

    const createdOrders = yield* readExportSelectedPathCreatedOrders(
      sql,
      identity,
      SESSION_EXPORT_SELECTED_PATH_CACHE_NODE_LIMIT,
    )
    if (!cache.remember(identity, createdOrders)) return NO_PREPARED_EXPORT_SELECTED_PATH
    return { selectedPathCreatedOrders: cache.readPage(identity, pageInput) ?? [] }
  })
}
