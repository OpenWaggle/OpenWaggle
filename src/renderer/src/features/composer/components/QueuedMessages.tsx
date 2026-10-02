import type { SessionId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import { Pause, Play, Timer } from 'lucide-react'
import { useState } from 'react'
import { useSessionFollowUpQueue } from '@/features/chat/hooks'
import {
  selectPendingSteerFollowUps,
  useBranchSummaryStore,
  useOptimisticSteerStore,
} from '@/features/chat/state'
import { Button } from '@/shared/ui/Button'
import { useQueuedMessageArrangement } from '../hooks/useQueuedMessageArrangement'
import { useQueuedMessageEdit } from '../hooks/useQueuedMessageEdit'
import {
  draftBusyReason,
  selectDraftActivity,
  useComposerActivityStore,
} from '../state/composer-activity-store'
import { useComposerStore } from '../state/composer-store'
import { ComposerDock } from './ComposerDock'
import { QueuedMessageRow } from './QueuedMessageRow'
import { followUpQueueAnnouncement, QueueUnavailableNotice } from './QueueUnavailableNotice'
import type { QueuedMessageRowActions } from './queued-message-row-types'

interface QueuedMessagesProps {
  readonly sessionId: SessionId | null
  readonly onSteer: (messageId: string) => Promise<void>
  readonly isStreaming: boolean
  readonly onToast: (message: string) => void
}

/*
 * What paused the queue, as the Host recorded it. Without it the dock said only "Queue paused",
 * which after a failed Run read as the app ignoring the messages.
 */
const PAUSE_REASON_COPY = {
  requested: 'Paused on request. Resume to send these messages.',
  'run-failed':
    'Paused because the last Run failed. Resume to send these, or send a new message to try again.',
  'run-interrupted': 'Paused because the last Run was stopped. Resume to send these messages.',
  'run-timed-out':
    'Paused because the last Run timed out waiting for a response. Resume to send these messages.',
  'parent-limit':
    'Paused because the parent Session has as many active Workers as it allows. Resume when one finishes.',
  'host-lost': 'Paused because OpenWaggle stopped during a Run. Resume to send these messages.',
  'profile-revoked': 'Paused because the access profile that sent these messages was revoked.',
} as const satisfies Record<FollowUpQueuePauseReason, string>

const UNKNOWN_PAUSE_COPY = 'The queue is paused. Resume to send these messages.'

function QueueHeader({
  count,
  headNeedsAttention,
  isChangingState,
  queueState,
  pauseReason,
  onResume,
  onPause,
}: {
  readonly count: number
  readonly headNeedsAttention: boolean
  readonly isChangingState: boolean
  readonly queueState: 'running' | 'paused'
  readonly pauseReason: FollowUpQueuePauseReason | undefined
  readonly onResume: () => void
  readonly onPause: () => void
}) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <QueueHeaderRow
        count={count}
        headNeedsAttention={headNeedsAttention}
        isChangingState={isChangingState}
        queueState={queueState}
        onResume={onResume}
        onPause={onPause}
      />
      {queueState === 'paused' ? (
        <p className="text-xs leading-normal text-text-tertiary">
          {pauseReason ? PAUSE_REASON_COPY[pauseReason] : UNKNOWN_PAUSE_COPY}
        </p>
      ) : null}
    </div>
  )
}

const QUEUE_STATE_BUTTON_CLASS =
  'ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-accent hover:bg-accent/8 aria-disabled:text-text-muted aria-disabled:opacity-50'

function QueueHeaderRow({
  count,
  headNeedsAttention,
  isChangingState,
  queueState,
  onResume,
  onPause,
}: {
  readonly count: number
  readonly headNeedsAttention: boolean
  readonly isChangingState: boolean
  readonly queueState: 'running' | 'paused'
  readonly onResume: () => void
  readonly onPause: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Timer className="size-3 text-text-tertiary" />
      <span className="text-xs font-semibold text-text-tertiary">
        {queueState === 'paused' ? 'Queue paused' : 'Queued'}
      </span>
      <span className="flex size-4.5 items-center justify-center rounded-full bg-text-tertiary/12 text-xs font-semibold text-text-tertiary">
        {count}
      </span>
      {queueState === 'paused' ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => {
            if (!isChangingState && !headNeedsAttention) onResume()
          }}
          aria-disabled={isChangingState || headNeedsAttention}
          title={
            headNeedsAttention
              ? 'Resolve the first Follow-up before resuming the queue.'
              : 'Resume Follow-up delivery'
          }
          className={QUEUE_STATE_BUTTON_CLASS}
        >
          <Play aria-hidden="true" className="size-3" />
          <span className="text-xs font-semibold">Resume</span>
        </Button>
      ) : (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => {
            if (!isChangingState) onPause()
          }}
          aria-disabled={isChangingState}
          title="Pause Follow-up delivery: the current Run finishes and nothing more starts until you resume"
          className={QUEUE_STATE_BUTTON_CLASS}
        >
          <Pause aria-hidden="true" className="size-3" />
          <span className="text-xs font-semibold">Pause</span>
        </Button>
      )}
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
export function QueuedMessages({ sessionId, onSteer, isStreaming, onToast }: QueuedMessagesProps) {
  const { snapshot, error, refresh, setPaused, withdraw, adopt } =
    useSessionFollowUpQueue(sessionId)
  const [isChangingQueueState, setIsChangingQueueState] = useState(false)
  const pendingPromotions = useOptimisticSteerStore(selectPendingSteerFollowUps(sessionId))
  // Reserved by a pending steering promotion: hidden from the dock and locked in place.
  const pendingIds = new Set(pendingPromotions)
  const queue = snapshot.items.filter((item) => !pendingIds.has(item.id))
  const queuedEdit = useQueuedMessageEdit(sessionId, onToast)
  const arrangement = useQueuedMessageArrangement(sessionId, queue, onToast)
  // An edit must not interleave with composer work in flight or a branch-summary prompt.
  const visibleKey = useComposerStore((state) => state.activeDraftContextKey)
  const sessionKey = visibleKey?.includes(`session:${String(sessionId)}:`) ? visibleKey : null
  const composerBusy =
    draftBusyReason(useComposerActivityStore(selectDraftActivity(sessionKey))) !== null
  const branchSummaryOpen = useBranchSummaryStore((state) => state.prompt !== null)
  const canBeginEdit = queuedEdit.edit === null && !composerBusy && !branchSummaryOpen

  async function dismiss(followUpId: string) {
    try {
      await withdraw(followUpId)
      queuedEdit.endWithdrawnEdit(followUpId)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    }
  }

  async function sendAsUser(followUpId: string) {
    try {
      await adopt(followUpId)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    }
  }

  // Revision-guarded by the hook; pausing lets the user change Session settings before resuming.
  async function changeQueueState(paused: boolean) {
    setIsChangingQueueState(true)
    try {
      await setPaused(paused)
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChangingQueueState(false)
    }
  }

  const rowActions: QueuedMessageRowActions = {
    onDismiss: (followUpId) => void dismiss(followUpId),
    onSteer: (followUpId) => void onSteer(followUpId),
    onAdopt: (followUpId) => void sendAsUser(followUpId),
    onEdit: (followUpId) => void queuedEdit.begin(followUpId),
    onMove: arrangement.onMove,
    onDragStart: arrangement.onDragStart,
    onDragEnd: arrangement.onDragEnd,
    dropAnchor: arrangement.dropAnchor,
    onDropOn: arrangement.onDropOn,
  }

  const queueUnavailable = sessionId !== null && error !== null
  const showDock = sessionId !== null && (queue.length > 0 || queueUnavailable)

  return (
    <>
      <span aria-live="polite" className="sr-only" role="status">
        {followUpQueueAnnouncement({
          hasSession: sessionId !== null,
          unavailable: queueUnavailable,
          count: queue.length,
          queueState: snapshot.state,
        })}
      </span>
      <span aria-live="polite" className="sr-only">
        <span key={arrangement.announcement.nonce}>{arrangement.announcement.text}</span>
      </span>
      {showDock ? (
        <ComposerDock className="flex flex-col gap-1.5 px-2.5 pt-2 pb-1.5">
          {queueUnavailable ? <QueueUnavailableNotice onRetry={refresh} /> : null}

          {queue.length > 0 ? (
            <>
              <QueueHeader
                count={queue.length}
                headNeedsAttention={queue[0]?.deliveryState === 'needs_attention'}
                isChangingState={isChangingQueueState}
                queueState={snapshot.state}
                pauseReason={snapshot.pauseReason}
                onResume={() => void changeQueueState(false)}
                onPause={() => void changeQueueState(true)}
              />

              <ul
                ref={arrangement.listRef}
                aria-label="Queued messages"
                className="flex flex-col gap-1"
              >
                {queue.map((item, index) => (
                  <QueuedMessageRow
                    key={item.id}
                    item={item}
                    neighbours={{
                      previousId: queue[index - 1]?.id ?? null,
                      nextId: queue[index + 1]?.id ?? null,
                    }}
                    reorderable={queue.length > 1}
                    isStreaming={isStreaming}
                    edit={{
                      canBegin: canBeginEdit,
                      phase: queuedEdit.edit?.followUpId === item.id ? queuedEdit.edit.phase : null,
                    }}
                    actions={rowActions}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </ComposerDock>
      ) : null}
    </>
  )
}
