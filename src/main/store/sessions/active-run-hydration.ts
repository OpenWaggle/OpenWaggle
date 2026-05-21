import { safeDecodeUnknown } from '@shared/schema'
import type { RunMode } from '@shared/types/background-run'
import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionInterruptedRun } from '@shared/types/session'
import type { RecoverableSessionActiveRun } from '../../ports/session-repository'
import { sessionsLogger } from './constants'
import { parseJson } from './json'
import { activeRunRuntimeSchema } from './schemas'
import type { SessionActiveRunRow } from './types'

export function hydrateRecoverableActiveRun(row: SessionActiveRunRow) {
  const runMode = parseActiveRunMode(row)
  const model = parseActiveRunModel(row)
  if (!runMode || !model) return null

  return {
    runId: row.run_id,
    sessionId: SessionId(row.session_id),
    branchId: SessionBranchId(row.branch_id),
    runMode,
    model,
  } satisfies RecoverableSessionActiveRun
}

export function interruptedRunsByBranchId(rows: readonly SessionActiveRunRow[]) {
  const interruptedRuns = new Map<string, SessionInterruptedRun>()
  for (const row of rows) {
    const interruptedRun = hydrateInterruptedRun(row)
    if (interruptedRun) interruptedRuns.set(String(interruptedRun.branchId), interruptedRun)
  }
  return interruptedRuns
}

function parseActiveRunMode(row: SessionActiveRunRow): RunMode | null {
  if (row.run_mode === 'classic' || row.run_mode === 'waggle') return row.run_mode
  sessionsLogger.warn('Ignoring session run with invalid mode', {
    runId: row.run_id,
    runMode: row.run_mode,
  })
  return null
}

function parseActiveRunModel(row: SessionActiveRunRow) {
  const runtime = safeDecodeUnknown(
    activeRunRuntimeSchema,
    parseJson(row.runtime_json, `active-run:${row.run_id}:runtime`),
  )
  if (runtime.success) return SupportedModelId(runtime.data.model)

  sessionsLogger.warn('Ignoring session run with invalid runtime metadata', { runId: row.run_id })
  return null
}

function hydrateInterruptedRun(row: SessionActiveRunRow) {
  if (row.status !== 'interrupted') return null
  const activeRun = hydrateRecoverableActiveRun(row)
  return activeRun ? { ...activeRun, interruptedAt: row.updated_at } : null
}
