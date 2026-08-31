import type { SessionId } from '@shared/types/brand'
import { AlertTriangle, ArrowUp, Play, RotateCcw, Timer, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { type SessionFollowUpQueueItem, useSessionFollowUpQueue } from '@/features/chat/hooks'
import { Button } from '@/shared/ui/Button'
import { ComposerDock } from './ComposerDock'

interface QueuedMessagesProps {
  readonly sessionId: SessionId | null
  readonly onSteer: (messageId: string) => Promise<void>
  readonly isStreaming: boolean
  readonly isCompacting?: boolean
  readonly onToast: (message: string) => void
}

const ATTENTION_REASON_COPY = {
  authorization_ceiling_changed:
    "Authorization changed. Update this Follow-up's authorization or dismiss it.",
  profile_revoked:
    'The submitting access profile was revoked. Restore access or dismiss this Follow-up.',
  authority_changed:
    'Session authority changed. Re-submit with current access or dismiss this Follow-up.',
} as const

function attentionCopy(item: SessionFollowUpQueueItem) {
  if (item.deliveryState !== 'needs_attention') return undefined
  return item.attentionReason
    ? ATTENTION_REASON_COPY[item.attentionReason]
    : 'This Follow-up cannot be delivered. Review Session access or dismiss it.'
}

function QueueHeader({
  count,
  headNeedsAttention,
  isCompacting,
  isResuming,
  queueState,
  onResume,
}: {
  readonly count: number
  readonly headNeedsAttention: boolean
  readonly isCompacting: boolean
  readonly isResuming: boolean
  readonly queueState: 'running' | 'paused'
  readonly onResume: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <Timer className="size-3 text-text-tertiary" />
      <span className="text-xs font-semibold text-text-tertiary">
        {isCompacting
          ? 'Queued until compaction finishes'
          : queueState === 'paused'
            ? 'Queue paused'
            : 'Queued'}
      </span>
      <span className="flex size-4.5 items-center justify-center rounded-full bg-text-tertiary/12 text-xs font-semibold text-text-tertiary">
        {count}
      </span>
      {queueState === 'paused' ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={onResume}
          disabled={isResuming || headNeedsAttention}
          title={
            headNeedsAttention
              ? 'Resolve the first Follow-up before resuming the queue.'
              : 'Resume Follow-up delivery'
          }
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-accent hover:bg-accent/8 disabled:text-text-muted disabled:opacity-50"
        >
          <Play className="size-3" />
          <span className="text-xs font-semibold">Resume</span>
        </Button>
      ) : null}
    </div>
  )
}

interface QueueItemsProps {
  readonly isCompacting: boolean
  readonly isStreaming: boolean
  readonly items: readonly SessionFollowUpQueueItem[]
  readonly resolvingId: string | null
  readonly onDismiss: (followUpId: string) => void
  readonly onResolve: (item: SessionFollowUpQueueItem) => void
  readonly onSteer: (followUpId: string) => void
}

function QueueItems({
  isCompacting,
  isStreaming,
  items,
  resolvingId,
  onDismiss,
  onResolve,
  onSteer,
}: QueueItemsProps) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => {
        const attention = attentionCopy(item)
        return (
          <div
            key={item.id}
            className={
              attention
                ? 'flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-2.5 py-2'
                : 'flex items-center gap-2 rounded-lg bg-bg/50 px-2.5 py-2'
            }
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="whitespace-pre-wrap text-xs leading-normal text-text-muted">
                {item.text || `${String(item.attachmentCount)} attachment(s)`}
              </div>
              {attention && (
                <div className="flex items-start gap-1 text-xs leading-normal text-warning">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>{attention}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {attention ? (
                <Button
                  variant="unstyled"
                  type="button"
                  onClick={() => onResolve(item)}
                  disabled={resolvingId !== null}
                  className="flex items-center gap-1 rounded-md border border-warning/30 bg-warning/8 px-2 py-1 text-warning hover:bg-warning/15 disabled:opacity-50"
                >
                  <RotateCcw className="size-3" />
                  <span className="text-xs font-semibold">
                    {item.attentionReason === 'authorization_ceiling_changed'
                      ? 'Use current access'
                      : 'Re-submit'}
                  </span>
                </Button>
              ) : null}
              {isStreaming && !isCompacting && (
                <Button
                  variant="unstyled"
                  type="button"
                  onClick={() => onSteer(item.id)}
                  disabled={item.deliveryState === 'needs_attention'}
                  title={attention ? 'Resolve this Follow-up before steering it.' : undefined}
                  className="flex items-center gap-1 rounded-md bg-accent/8 px-2 py-1"
                >
                  <ArrowUp className="size-3 text-accent" />
                  <span className="text-xs font-semibold text-accent">Steer</span>
                </Button>
              )}
              <Button
                variant="unstyled"
                type="button"
                onClick={() => onDismiss(item.id)}
                className="rounded-md px-1.5 py-1"
                title="Dismiss"
              >
                <Trash2 className="size-3 text-text-muted hover:text-text-primary" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Queued messages panel that docks above the Composer.
 *
 * The Composer fills 100% of the parent container. The queue stays inset just
 * inside the composer's rounded shoulders so it reads like a docked tab rather
 * than a separate full-width panel.
 */
export function QueuedMessages({
  sessionId,
  onSteer,
  isStreaming,
  isCompacting = false,
  onToast,
}: QueuedMessagesProps) {
  const { snapshot, resubmitWithCurrentAccess, setPaused, withdraw } =
    useSessionFollowUpQueue(sessionId)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [isResuming, setIsResuming] = useState(false)
  const queue = snapshot.items

  async function resolveAttention(item: SessionFollowUpQueueItem) {
    setResolvingId(item.id)
    try {
      await resubmitWithCurrentAccess(item.id)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    } finally {
      setResolvingId(null)
    }
  }

  async function dismiss(followUpId: string) {
    try {
      await withdraw(followUpId)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    }
  }

  async function resumeQueue() {
    setIsResuming(true)
    try {
      await setPaused(false)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    } finally {
      setIsResuming(false)
    }
  }

  if (queue.length === 0 || !sessionId) return null

  return (
    <ComposerDock className="flex flex-col gap-1.5 px-2.5 pt-2 pb-1.5">
      <QueueHeader
        count={queue.length}
        headNeedsAttention={queue[0]?.deliveryState === 'needs_attention'}
        isCompacting={isCompacting}
        isResuming={isResuming}
        queueState={snapshot.state}
        onResume={() => void resumeQueue()}
      />

      <QueueItems
        isCompacting={isCompacting}
        isStreaming={isStreaming}
        items={queue}
        resolvingId={resolvingId}
        onDismiss={(followUpId) => void dismiss(followUpId)}
        onResolve={(item) => void resolveAttention(item)}
        onSteer={(followUpId) => void onSteer(followUpId)}
      />
    </ComposerDock>
  )
}
