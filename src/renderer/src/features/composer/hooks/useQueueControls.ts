import type { SessionId } from '@shared/types/brand'
import { useState } from 'react'
import { type SessionFollowUpQueueSnapshot, useSessionFollowUpQueue } from '@/features/chat/hooks'
import { createRendererLogger } from '@/shared/lib/logger'
import {
  isStaleQueueRevision,
  QUEUE_CONTROL_COPY,
  type QueueControlAction,
  queueControlFailureMessage,
} from '../lib/queue-control-messages'

const logger = createRendererLogger('queue-controls')

/**
 * Whether the action still applies to a queue re-read after another change landed first: what it
 * should do now, nothing (someone already got the queue there), or a reason it no longer can.
 */
type RetryPlan =
  | { readonly kind: 'retry' }
  | { readonly kind: 'done' }
  | { readonly kind: 'refused'; readonly message: string }

function planQueueStateRetry(fresh: SessionFollowUpQueueSnapshot, paused: boolean): RetryPlan {
  if (fresh.state === (paused ? 'paused' : 'running')) return { kind: 'done' }
  if (!paused && fresh.items[0]?.deliveryState === 'needs_attention') {
    return { kind: 'refused', message: QUEUE_CONTROL_COPY.resumeBlocked }
  }
  return { kind: 'retry' }
}

function planSendAsMeRetry(fresh: SessionFollowUpQueueSnapshot, followUpId: string): RetryPlan {
  const item = fresh.items.find((candidate) => candidate.id === followUpId)
  if (!item) return { kind: 'refused', message: QUEUE_CONTROL_COPY.messageGone }
  // Someone else already sent it, or its access came back: it no longer waits on the user.
  if (item.deliveryState !== 'needs_attention') return { kind: 'done' }
  return { kind: 'retry' }
}

/**
 * Pause, Resume and "Send as me" from the queue dock. Each is guarded by the queue revision the
 * dock shows; when another change landed first, the action is replayed once against the re-read
 * queue if it still applies (like `useQueuedMessageReorder`), and the user hears about it only
 * when it cannot be applied. Refusals read as what happened, not as the Host's code.
 */
export function useQueueControls(sessionId: SessionId | null, onToast: (message: string) => void) {
  const { snapshot, refresh, setPaused, adopt } = useSessionFollowUpQueue(sessionId)
  const [isChangingState, setIsChangingState] = useState(false)
  const [adoptingId, setAdoptingId] = useState<string | null>(null)

  function report(action: QueueControlAction, error: unknown) {
    logger.warn('Queue action failed', {
      action,
      sessionId: String(sessionId),
      error: error instanceof Error ? error.message : String(error),
    })
    onToast(queueControlFailureMessage(action, error))
  }

  async function run(
    action: QueueControlAction,
    apply: (revision: number) => Promise<void>,
    plan: (fresh: SessionFollowUpQueueSnapshot) => RetryPlan,
  ) {
    try {
      await apply(snapshot.revision)
      return
    } catch (error) {
      if (!isStaleQueueRevision(error)) {
        report(action, error)
        return
      }
    }
    try {
      const fresh = await refresh()
      if (!fresh) return
      const next = plan(fresh)
      if (next.kind === 'done') return
      if (next.kind === 'refused') {
        onToast(next.message)
        return
      }
      await apply(fresh.revision)
    } catch (error) {
      report(action, error)
    }
  }

  async function changeQueueState(paused: boolean) {
    if (isChangingState) return
    setIsChangingState(true)
    try {
      await run(
        paused ? 'pause' : 'resume',
        (revision) => setPaused(paused, revision),
        (fresh) => planQueueStateRetry(fresh, paused),
      )
    } finally {
      setIsChangingState(false)
    }
  }

  /** Repeat clicks on the same row are ignored by the row while `adoptingId` names it. */
  async function sendAsMe(followUpId: string) {
    setAdoptingId(followUpId)
    try {
      await run(
        'send-as-me',
        (revision) => adopt(followUpId, revision),
        (fresh) => planSendAsMeRetry(fresh, followUpId),
      )
    } finally {
      setAdoptingId(null)
    }
  }

  return { isChangingState, adoptingId, changeQueueState, sendAsMe }
}
