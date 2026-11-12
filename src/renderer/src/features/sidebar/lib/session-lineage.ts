import { runningWorkerCount, runningWorkersLabel } from '@shared/domain/running-workers'
import type { SessionSummary } from '@shared/types/session'

export interface SessionLineagePresentation {
  readonly role: 'queen' | 'worker'
  readonly title: string
  readonly workerCount: number
}

function directWorkerDescription(count: number) {
  if (count === 0) return ''
  return ` · ${String(count)} direct Worker${count === 1 ? '' : 's'}`
}

/** Why a parent row reads Working while its own Run is idle (ADR 0065). */
function runningWorkersDescription(session: SessionSummary) {
  const count = runningWorkerCount(session.lineage)
  return count === 0 ? '' : ` · ${runningWorkersLabel(count)}`
}

export function sessionLineagePresentation(
  session: SessionSummary,
): SessionLineagePresentation | null {
  const lineage = session.lineage
  if (lineage?.role === 'queen') {
    const agent = lineage.agentDefinitionName ? ` · Agent: ${lineage.agentDefinitionName}` : ''
    return {
      role: lineage.role,
      title: `Queen Session${agent}${directWorkerDescription(lineage.directWorkerCount)}${runningWorkersDescription(session)}`,
      workerCount: lineage.directWorkerCount,
    }
  }
  if (lineage?.role === 'worker') {
    // The parent in the words every Hive surface uses (#377).
    const parent = lineage.parentTitle ? ` · Spawned by ${lineage.parentTitle}` : ''
    const agent = lineage.agentDefinitionName ? ` · Agent: ${lineage.agentDefinitionName}` : ''
    return {
      role: lineage.role,
      title: `Worker Session${parent}${agent}${directWorkerDescription(lineage.directWorkerCount)}${runningWorkersDescription(session)}`,
      workerCount: lineage.directWorkerCount,
    }
  }
  return null
}
