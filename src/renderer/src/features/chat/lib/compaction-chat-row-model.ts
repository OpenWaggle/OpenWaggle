import type { AgentCompactionStatus } from '../hooks/useAgentChat.types'
import { acknowledgeCompactionStatus } from './compaction-lifecycle'
import type { ChatRow } from './types-chat-row'

type CompactionStatusRow = Extract<ChatRow, { type: 'compaction-status' }>

export function createCompactionStatusRows(
  status: AgentCompactionStatus | null | undefined,
  durableSummaryIds: readonly string[],
): CompactionStatusRow[] {
  if (!status) return []
  const acknowledgedStatus = acknowledgeCompactionStatus(status, durableSummaryIds)
  const timelineStatus =
    acknowledgedStatus?.type === 'retrying'
      ? acknowledgedStatus.previousCompactionStatus
      : acknowledgedStatus
  if (!timelineStatus) return []
  return timelineStatus.timeline.map((item, index) => {
    const automatic = item.reason !== 'manual'
    return {
      type: 'compaction-status',
      id: item.id,
      anchorMessageCount: item.messageCountAtStart,
      announce:
        !timelineStatus.suppressAnnouncement && index === timelineStatus.timeline.length - 1,
      state: `${automatic ? 'automatic' : 'manual'}-${item.phase === 'running' ? 'running' : 'complete'}`,
    }
  })
}

export function createCompactionRowAppender(target: ChatRow[], rows: CompactionStatusRow[]) {
  let nextRow = 0
  return (messageCount: number) => {
    while (nextRow < rows.length && rows[nextRow].anchorMessageCount <= messageCount) {
      target.push(rows[nextRow])
      nextRow += 1
    }
  }
}
