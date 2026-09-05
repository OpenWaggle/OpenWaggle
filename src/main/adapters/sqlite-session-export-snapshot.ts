import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportBranchScope } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import { resolveSelectedBranchSnapshotHead } from './sqlite-session-branch-snapshot'

export function resolveExportSnapshotHead(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly branchScope: SessionExportBranchScope
    readonly selectedBranchId: string | null
    readonly suppliedHeadNodeId?: string
  },
) {
  return Effect.gen(function* () {
    if (input.branchScope === 'tree') {
      return input.suppliedHeadNodeId
        ? { status: 'not-found' as const, message: 'Tree exports do not select a branch head.' }
        : { status: 'ready' as const, headNodeId: null, branchHeadNodeId: null }
    }
    if (!input.selectedBranchId) {
      return { status: 'not-found' as const, message: 'Session branch not found.' }
    }
    const branch = yield* resolveSelectedBranchSnapshotHead(sql, {
      sessionId: input.sessionId,
      selectedBranchId: input.selectedBranchId,
      ...(input.suppliedHeadNodeId ? { suppliedHeadNodeId: input.suppliedHeadNodeId } : {}),
    })
    return branch.status === 'ready'
      ? branch
      : {
          status: 'not-found' as const,
          message: input.suppliedHeadNodeId
            ? 'Session export snapshot head does not belong to the selected branch.'
            : 'Session branch not found.',
        }
  })
}
