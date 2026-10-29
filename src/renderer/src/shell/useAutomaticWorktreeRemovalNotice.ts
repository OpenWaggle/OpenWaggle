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

/**
 * Every unannounced run as one: a Host that ran for days while the app was closed removed
 * worktrees in several runs, and the notice says what they freed together.
 */
function unannouncedRemovals(log: AutomaticWorktreeRemovalLog) {
  const ids = new Set(log.unannouncedRunIds)
  const runs = log.runs.filter((run) => ids.has(run.id))
  const newest = runs[0]
  if (!newest) return null
  return { newestRunId: newest.id, removed: runs.flatMap((run) => run.removed) }
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
        const removals = unannouncedRemovals(await api.getAutomaticWorktreeRemovalLog())
        if (cancelled || !removals) return
        // Only the window that claimed the runs announces them.
        if (!(await api.acknowledgeAutomaticWorktreeRemoval(removals.newestRunId)) || cancelled) {
          return
        }
        announce(removals.removed.length, automaticRemovalFreedBytes(removals))
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
