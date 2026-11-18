import type { StreamingPhaseState } from '../hooks/useStreamingPhase'
import type { AgentCompactionStatus } from './compaction-lifecycle'
import type { ChatRow } from './types-chat-row'

/** What the Run's Pi extensions say they are doing (`extension-status-store`). */
export interface ExtensionStatusRowInput {
  readonly statuses: readonly { readonly key: string; readonly text: string }[]
  readonly workingMessage?: string
}

/** Generic labels an extension's working message replaces, as Pi's TUI replaces its loader text. */
const WORKING_MESSAGE_LABELS: ReadonlySet<string> = new Set(['Thinking', 'Finishing'])

interface StatusRowInput {
  readonly phase: StreamingPhaseState
  readonly isLoading: boolean
  /** The agent ended the Run and the Host is still settling it (see `run-finishing-store`). */
  readonly isFinishing?: boolean
  readonly error: Error | undefined
  readonly lastUserMessage: string | null
  readonly dismissedError: string | null
  readonly sessionId: string | null
  readonly compactionStatus?: AgentCompactionStatus | null
  /**
   * A new Session's first message was sent and nothing has reported back yet: no launch step, no
   * run. The Host may be creating the Session or building the runtime; say so instead of nothing.
   */
  readonly awaitingFirstRun?: boolean
  readonly extensionStatus?: ExtensionStatusRowInput
}

/**
 * The Run's status row says what its extensions report: the working message in place of a generic
 * label, and each status line under it. That is how a slow `agent_before_settle` check shows why the
 * Run is still finishing.
 */
function withExtensionStatus(rows: ChatRow[], from: number, status: ExtensionStatusRowInput) {
  const index = rows.findIndex(
    (row, rowIndex) => rowIndex >= from && row.type === 'phase-indicator',
  )
  const row = rows[index]
  if (row?.type !== 'phase-indicator') return
  const label =
    status.workingMessage !== undefined && WORKING_MESSAGE_LABELS.has(row.label)
      ? status.workingMessage
      : row.label
  rows[index] = {
    ...row,
    label,
    ...(status.statuses.length > 0 ? { details: status.statuses } : {}),
  }
}

// A failed Run shows its error while it settles; a clean one says it is being wrapped up.
function appendFinishingRow(rows: ChatRow[], input: StatusRowInput) {
  if (!input.isFinishing || input.phase.current || input.isLoading || input.error) return
  rows.push({ type: 'phase-indicator', label: 'Finishing', elapsedMs: 0 })
}

export function appendStatusRows(rows: ChatRow[], input: StatusRowInput) {
  const from = rows.length
  appendRunStatusRows(rows, input)
  if (input.extensionStatus) withExtensionStatus(rows, from, input.extensionStatus)
}

function appendRunStatusRows(rows: ChatRow[], input: StatusRowInput) {
  if (input.compactionStatus?.type === 'retrying') {
    rows.push({
      type: 'retry-status',
      attempt: input.compactionStatus.attempt,
      maxAttempts: input.compactionStatus.maxAttempts,
      delayMs: input.compactionStatus.delayMs,
    })
    return
  }
  if (input.compactionStatus?.type === 'compacting') return
  if (input.phase.current) {
    rows.push({
      type: 'phase-indicator',
      label: input.phase.current.label,
      elapsedMs: input.phase.current.elapsedMs,
    })
  }
  if (!input.phase.current && input.isLoading) {
    rows.push({
      type: 'phase-indicator',
      label: 'Thinking',
      elapsedMs: input.phase.totalElapsedMs,
    })
  }
  appendFinishingRow(rows, input)
  if (!input.phase.current && !input.isLoading && !input.error && input.awaitingFirstRun) {
    rows.push({ type: 'phase-indicator', label: 'Starting session', elapsedMs: 0 })
  }
  if (input.error && !input.isLoading) {
    rows.push({
      type: 'error',
      error: input.error,
      lastUserMessage: input.lastUserMessage,
      dismissedError: input.dismissedError,
      sessionId: input.sessionId,
    })
  }
}
