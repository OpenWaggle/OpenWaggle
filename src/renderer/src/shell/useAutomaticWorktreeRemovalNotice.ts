import type { AutomaticWorktreeRemovalLog } from '@shared/types/worktree-inventory'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { formatBytes } from '@/shared/lib/format'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('worktrees')

export const AutomaticWorktreeRemovalNoticeCopy = {
  message: (count: number, bytes: number) =>
    `Automatic removal freed about ${formatBytes(bytes)} (${String(count)} ${
      count === 1 ? 'worktree' : 'worktrees'
    }).`,
  action: 'View',
} as const

function unannouncedRun(log: AutomaticWorktreeRemovalLog) {
  return log.unannouncedRunId === null
    ? undefined
    : log.runs.find((run) => run.id === log.unannouncedRunId)
}

/**
 * Says once, when the app opens, that Automatic worktree removal removed something (ADR 0060).
 * The Host records the run as announced, so another window or the next start stays quiet.
 */
export function useAutomaticWorktreeRemovalNotice() {
  const navigate = useNavigate()
  const announce = useEffectEvent((count: number, bytes: number) => {
    useUIStore.getState().showActionToast({
      message: AutomaticWorktreeRemovalNoticeCopy.message(count, bytes),
      variant: 'success',
      action: {
        label: AutomaticWorktreeRemovalNoticeCopy.action,
        onClick: () => void navigate({ to: '/settings/$tab', params: { tab: 'worktrees' } }),
      },
    })
  })
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const run = unannouncedRun(await api.getAutomaticWorktreeRemovalLog())
        if (cancelled || !run) return
        await api.acknowledgeAutomaticWorktreeRemoval(run.id)
        const bytes = run.removed.reduce((sum, removed) => sum + (removed.reclaimableBytes ?? 0), 0)
        announce(run.removed.length, bytes)
      } catch (error) {
        logger.warn('Could not read the automatic worktree removal record', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
}
