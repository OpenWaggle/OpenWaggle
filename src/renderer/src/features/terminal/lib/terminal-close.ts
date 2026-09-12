import type { TerminalCloseAssessment } from '@shared/types/terminal'
import { api } from '@/shared/lib/ipc'

export interface TerminalCloseTarget {
  readonly terminalId: string
  readonly label: string
}

function uniqueSorted<T extends number | string>(values: readonly T[]) {
  return [...new Set(values)].sort((left, right) =>
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right)),
  )
}

function confirmationDetail(
  targets: readonly TerminalCloseTarget[],
  assessments: readonly TerminalCloseAssessment[],
  intent: 'close' | 'restart',
) {
  const confirmations = assessments.filter(
    (assessment): assessment is Extract<TerminalCloseAssessment, { disposition: 'confirm' }> =>
      assessment.disposition === 'confirm',
  )
  const processNames = uniqueSorted(confirmations.flatMap((item) => item.processNames))
  const ports = uniqueSorted(confirmations.flatMap((item) => item.ports))
  const lines = [
    intent === 'close'
      ? 'This stops the running process tree and permanently deletes its terminal history.'
      : 'This stops the running process tree, clears its terminal history, and starts a fresh shell.',
  ]
  if (targets.length > 1) lines.push(`Terminals: ${targets.map((item) => item.label).join(', ')}`)
  if (processNames.length > 0) lines.push(`Processes: ${processNames.join(', ')}`)
  if (ports.length > 0) lines.push(`Listening ports: ${ports.join(', ')}`)
  if (confirmations.some((item) => item.reason === 'uncertain')) {
    lines.push('OpenWaggle could not verify that every process is idle.')
  }
  return lines.join('\n')
}

export async function confirmTerminalStop(
  ownerKey: string,
  targets: readonly [TerminalCloseTarget, ...TerminalCloseTarget[]],
  intent: 'close' | 'restart',
) {
  const assessments = await Promise.all(
    targets.map((target) => api.assessTerminalClose(ownerKey, target.terminalId)),
  )
  if (!assessments.some((assessment) => assessment.disposition === 'confirm')) return true
  const action = intent === 'close' ? 'Close' : 'Restart'
  return api.showConfirm(
    targets.length === 1
      ? `${action} ${targets[0].label}?`
      : `${action} ${targets.length} terminals?`,
    confirmationDetail(targets, assessments, intent),
  )
}

/**
 * Closes one or more terminals with a single impact-aware confirmation. Safe
 * dead/idle terminals close immediately; uncertain state is treated as active.
 */
export async function confirmAndCloseTerminals(
  ownerKey: string,
  targets: readonly [TerminalCloseTarget, ...TerminalCloseTarget[]],
): Promise<'cancelled' | 'closed'> {
  if (!(await confirmTerminalStop(ownerKey, targets, 'close'))) return 'cancelled'

  await Promise.all(targets.map((target) => api.closeTerminal(ownerKey, target.terminalId, true)))
  return 'closed'
}
