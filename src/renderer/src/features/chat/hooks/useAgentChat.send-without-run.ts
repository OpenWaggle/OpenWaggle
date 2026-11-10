import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSendReport } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import {
  isPiSessionFileRefusal,
  MessageNotDelivered,
  SendFailedOutOfView,
} from '../lib/message-delivery'
import { useBackgroundRunStore } from '../state/background-run-store'
import {
  clearRunPointers,
  type ForegroundRun,
  type ForegroundRunRefs,
  type ForegroundRunSetters,
} from './useAgentChat.foreground-run'
import { updateMessagesForSession } from './useAgentChat.message-cache'

/**
 * A send that started no Run, so nothing will complete for it. The Host either kept the message as
 * a Follow-up - the Session still had a Run settling, or Follow-ups waiting in a queue a failed Run
 * paused - and it is shown in the queue with a way to resume it; or the Host refused it, and the
 * caller puts it back in the composer and says why. Either way the Session goes back to what it
 * was showing and the message leaves the transcript; left there, a refused send showed "Thinking"
 * and Stop over a message the agent never got. If the Host has already started a queued one as
 * the next Run, its row is that Run's incorporated user message and stays.
 */
export function forgetSendWithoutRun(input: {
  readonly refs: ForegroundRunRefs
  readonly setters: ForegroundRunSetters
  readonly targetSessionId: SessionId
  readonly run: ForegroundRun
  readonly optimisticMessageId: UIMessage['id']
}) {
  input.run.handBack(input.refs, input.targetSessionId, input.setters)
  dropOptimisticSend(input)
}

/**
 * A send whose invoke failed before any Run, unless it shows that failure itself: it owns the
 * Session's status and displaced no earlier send still waiting on its Run. Otherwise another
 * send's Run owns the status (a later send, or an earlier one still settling), and marking the
 * Session failed would hide that Run or lose its completion. The send then leaves the chain and
 * the transcript, handing back what it displaced, and as no error of the Session's shows it, the
 * caller's toast says why. A delivered send's failure is the Run's, so it is never asked here.
 */
export function forgetIfFailedOutOfView(
  sent: Parameters<typeof forgetSendWithoutRun>[0],
  error: Error,
) {
  const pending = sent.refs.pendingRunWaiterRef.current
  const showsOwn =
    pending === null || (pending === sent.run.waiter && !sent.run.displacesPendingSend())
  if (showsOwn) return undefined
  forgetSendWithoutRun(sent)
  return new SendFailedOutOfView(error)
}

/** A send's report that started no Run. */
export type ReportWithoutRun = {
  readonly [Outcome in Exclude<AgentSendReport['outcome'], 'delivered'>]: Omit<
    AgentSendReport,
    'outcome'
  > & { readonly outcome: Outcome }
}[Exclude<AgentSendReport['outcome'], 'delivered'>]

/**
 * Ends a send whose report started no Run and says what the caller is owed. Queued: nothing, the
 * message is in the queue now. Refused: the reason, and the send ends here, since no Run will
 * report back. Cancelled: the reason only, as the user's Stop already reset the Session.
 */
export function settleSendWithoutRun(
  sent: Parameters<typeof forgetSendWithoutRun>[0],
  report: ReportWithoutRun,
) {
  return matchBy(report, 'outcome')
    .with('queued', () => {
      forgetSendWithoutRun(sent)
      return undefined
    })
    .with('refused', (refused) => {
      forgetSendWithoutRun(sent)
      return new MessageNotDelivered(refused.outcome, refused.message, refused.code)
    })
    .with(
      'cancelled',
      (cancelled) => new MessageNotDelivered(cancelled.outcome, cancelled.message, cancelled.code),
    )
    .exhaustive()
}

/**
 * A send the Host refused before the agent got the message, as for a Session whose Pi file cannot
 * be used: the Run it started is over, so the Session is idle again, with no error of its own to
 * show, and the message leaves the transcript. Returns the refusal, for the caller, undelivered;
 * nothing for any other failure.
 */
export function forgetIfRefusedForPiSessionFile(
  input: {
    readonly refs: ForegroundRunRefs
    readonly setters: ForegroundRunSetters
    readonly targetSessionId: SessionId
    readonly run: ForegroundRun
    readonly optimisticMessageId: UIMessage['id']
  },
  refusal: Error,
) {
  if (!isPiSessionFileRefusal(refusal)) return undefined
  const { refs, setters, targetSessionId } = input
  const ownsForeground = refs.pendingRunWaiterRef.current === input.run.waiter
  // An earlier send's Run still settles: hand its state back, so its completion is followed.
  if (ownsForeground && input.run.displacesPendingSend()) {
    forgetSendWithoutRun(input)
    return new MessageNotDelivered('refused', refusal.message)
  }
  if (ownsForeground) refs.pendingRunWaiterRef.current = null
  // A later send owns the foreground and the status: leave both to it.
  const laterSendOwnsForeground = !ownsForeground && refs.pendingRunWaiterRef.current !== null
  if (laterSendOwnsForeground) input.run.spliceOut()
  if (!laterSendOwnsForeground && refs.foregroundSessionIdRef.current === targetSessionId) {
    clearRunPointers(refs)
  }
  if (!laterSendOwnsForeground && refs.currentSessionIdRef.current === targetSessionId) {
    setters.setError(undefined)
    setters.setStatus('ready')
  }
  dropOptimisticSend(input)
  return new MessageNotDelivered('refused', refusal.message)
}

function dropOptimisticSend(input: {
  readonly refs: ForegroundRunRefs
  readonly setters: ForegroundRunSetters
  readonly targetSessionId: SessionId
  readonly optimisticMessageId: UIMessage['id']
}) {
  const { refs, setters, targetSessionId, optimisticMessageId } = input
  setters.removeOptimisticUserMessage(targetSessionId, optimisticMessageId)
  updateMessagesForSession(
    refs.messagesBySessionIdRef,
    setters.setMessagesBySessionId,
    setters.setRunRenderMessages,
    targetSessionId,
    // A row that took a log order is a message the Host already started as the next Run's input.
    (currentMessages) =>
      currentMessages.filter(
        (message) =>
          message.id !== optimisticMessageId ||
          message.metadata?.sessionNodeCreatedOrder !== undefined,
      ),
    { cacheRunSnapshot: true },
  )
}

/**
 * Whether a failed first send leaves nothing to recover: the Host refused it, or its call failed
 * behind a later send, before any Run, so the message goes back to the composer. A worktree launch that failed is reported refused too,
 * but its row offers Retry and keeps the draft, so its recovery stays.
 */
export function refusalLeavesNothingToRecover(sessionId: SessionId, error: unknown) {
  const refused = error instanceof MessageNotDelivered && error.outcome === 'refused'
  if (!refused && !(error instanceof SendFailedOutOfView)) return false
  return useBackgroundRunStore.getState().getWorktreeLaunch(sessionId) === null
}

/** Forgets a refused first send's recovery: its message is back in the composer. */
export function forgetRefusedFirstSend(
  sessionId: SessionId,
  error: unknown,
  params: { readonly setFirstSendRecovery: (sessionId: SessionId, recovery: null) => void },
) {
  if (refusalLeavesNothingToRecover(sessionId, error)) params.setFirstSendRecovery(sessionId, null)
}
