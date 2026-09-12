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

export function sessionLineagePresentation(
  session: SessionSummary,
): SessionLineagePresentation | null {
  const lineage = session.lineage
  if (lineage?.role === 'queen') {
    const agent = lineage.agentDefinitionName ? ` · Agent: ${lineage.agentDefinitionName}` : ''
    return {
      role: lineage.role,
      title: `Queen Session${agent}${directWorkerDescription(lineage.directWorkerCount)}`,
      workerCount: lineage.directWorkerCount,
    }
  }
  if (lineage?.role === 'worker') {
    const parent = lineage.parentTitle ? ` · Parent: ${lineage.parentTitle}` : ''
    const agent = lineage.agentDefinitionName ? ` · Agent: ${lineage.agentDefinitionName}` : ''
    return {
      role: lineage.role,
      title: `Worker Session${parent}${agent}${directWorkerDescription(lineage.directWorkerCount)}`,
      workerCount: lineage.directWorkerCount,
    }
  }
  return null
}
