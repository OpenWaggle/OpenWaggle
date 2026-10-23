import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef } from 'react'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { useUIStore } from '@/shell/ui-store'
import {
  noticeSnapshots,
  type ScheduledTaskNotice,
  type ScheduledTaskNoticeSnapshot,
  scheduledTaskNotices,
} from '../lib/task-notices'
import { useScheduledTaskIndexStore } from '../state/scheduled-task-index-store'
import { useOpenScheduledTask } from './useShowScheduledTasks'

function toastMessage(notices: readonly ScheduledTaskNotice[]) {
  const [first] = notices
  if (!first) return ''
  return notices.length === 1
    ? first.message
    : `${first.message} (+${String(notices.length - 1)} more)`
}

/**
 * Mounted once in the app shell. Keeps the sidebar's derived index current and announces new
 * Scheduled task runs in the app toast: failures and attention always, started runs only for a
 * task whose notification policy is "Every run".
 */
export function useScheduledTasksMonitor(): void {
  const { data: tasks } = useQuery(scheduledTasksListQueryOptions())
  const index = useScheduledTaskIndexStore((state) => state.index)
  const openTask = useOpenScheduledTask()
  const previous = useRef<ReadonlyMap<string, ScheduledTaskNoticeSnapshot> | null>(null)

  const announce = useEffectEvent((notices: readonly ScheduledTaskNotice[]) => {
    // Failures outrank a started run when one refresh brings both.
    const ordered = [...notices].sort(
      (left, right) => Number(right.variant === 'error') - Number(left.variant === 'error'),
    )
    const [first] = ordered
    if (!first) return
    useUIStore.getState().showActionToast({
      message: toastMessage(ordered),
      variant: first.variant,
      action: { label: 'Open', onClick: () => openTask(first.taskId) },
    })
  })

  useEffect(() => {
    if (!tasks) return
    index(tasks)
    const notices = scheduledTaskNotices(previous.current, tasks)
    previous.current = noticeSnapshots(tasks)
    if (notices.length > 0) announce(notices)
  }, [tasks, index])
}
