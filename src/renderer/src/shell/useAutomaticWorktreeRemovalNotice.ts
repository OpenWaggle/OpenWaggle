import type { AutomaticWorktreeRemovalLog } from '@shared/types/worktree-inventory'
import { automaticRemovalFreedBytes } from '@shared/utils/automatic-worktree-removal'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { formatBytes } from '@/shared/lib/format'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('worktrees')

export const AutomaticWorktreeRemovalNoticeCopy = {
  /** `freed` is null when no removed worktree was measured, so no size is claimed. */
  message: (count: number, freed: ReturnType<typeof automaticRemovalFreedBytes>) => {
    const worktrees = `${String(count)} ${count === 1 ? 'worktree' : 'worktrees'}`
    if (freed === null) return `Automatic removal removed ${worktrees}.`
    const size = `${freed.complete ? 'about' : 'at least'} ${formatBytes(freed.bytes)}`
    return `Automatic removal freed ${size} (${worktrees}).`
  },
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
  const announce = useEffectEvent(
    (count: number, freed: ReturnType<typeof automaticRemovalFreedBytes>) => {
      useUIStore.getState().showActionToast({
        message: AutomaticWorktreeRemovalNoticeCopy.message(count, freed),
        variant: 'success',
        action: {
          label: AutomaticWorktreeRemovalNoticeCopy.action,
          onClick: () => void navigate({ to: '/settings/$tab', params: { tab: 'worktrees' } }),
        },
      })
    },
  )
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const run = unannouncedRun(await api.getAutomaticWorktreeRemovalLog())
        if (cancelled || !run) return
        // Only the window that claimed the run announces it.
        if (!(await api.acknowledgeAutomaticWorktreeRemoval(run.id)) || cancelled) return
        announce(run.removed.length, automaticRemovalFreedBytes(run))
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
