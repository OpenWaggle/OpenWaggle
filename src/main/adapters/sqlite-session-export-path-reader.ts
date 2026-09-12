import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  ExportSelectedPathSnapshotIdentity,
  SessionExportSelectedPathCache,
} from './session-export-selected-path-cache'
import type { exportNodeReadStrategy } from './sqlite-session-export-node-reader'
import { ensureDurableExportSelectedPathIdentity } from './sqlite-session-export-selected-path'

interface ExportSelectedPathReadInput {
  readonly readStrategy: ReturnType<typeof exportNodeReadStrategy>
  readonly exportOperationId: string | undefined
  readonly sessionId: string
  readonly selectedBranchId: string | null
  readonly selectedHeadNodeId: string | null
  readonly nodeMutationRevision: number
}

const NO_PREPARED_EXPORT_SELECTED_PATH = {}

export function prepareExportSelectedPath(
  sql: SqlClient.SqlClient,
  cache: SessionExportSelectedPathCache,
  input: ExportSelectedPathReadInput,
) {
  return Effect.gen(function* () {
    if (
      input.readStrategy !== 'checkpointed-branch' ||
      !input.selectedBranchId ||
      !input.selectedHeadNodeId
    ) {
      return NO_PREPARED_EXPORT_SELECTED_PATH
    }
    const identity: ExportSelectedPathSnapshotIdentity = {
      sessionId: input.sessionId,
      selectedBranchId: input.selectedBranchId,
      selectedHeadNodeId: input.selectedHeadNodeId,
      nodeMutationRevision: input.nodeMutationRevision,
    }
    if (input.exportOperationId) {
      yield* ensureDurableExportSelectedPathIdentity(
        sql,
        {
          ...identity,
          exportOperationId: input.exportOperationId,
        },
        Date.now(),
      )
      return NO_PREPARED_EXPORT_SELECTED_PATH
    }

    cache.remember(identity)
    return NO_PREPARED_EXPORT_SELECTED_PATH
  })
}
