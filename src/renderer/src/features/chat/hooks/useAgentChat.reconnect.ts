import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import { useOptimisticSteerStore } from '@/features/chat/state/optimistic-steer-store'
import { api } from '@/shared/lib/ipc'
import { incorporatedUserRow, placeReconnectedRunMessages } from '../lib/chat-stream-user-messages'
import {
  earlierAnswersOf,
  earlierReconnectMessageIds,
  partialAssistantOf,
  streamingBaselineOf,
  userMessageAnchorsOf,
} from '../lib/reconnect-buffer-anchors'
import { reconnectedRunScope, runScopeOf, withoutShownRunAnswers } from '../lib/reconnect-run-scope'
import { withoutSavedRunAnswers } from '../lib/saved-run-answers'
import { unsettledRunMessages } from '../lib/seeded-run-messages'
import { mergeBackgroundReconnectMessages, sessionToUIMessages } from '../lib/useAgentChat.utils'
import {
  getMessagesForSession,
  mergeSessionAndOptimisticMessages,
  updateMessagesForSession,
} from './useAgentChat.message-cache'
import type { SessionHydrationContext, SessionHydrationInput } from './useAgentChat.types'

/*
 * A Run's reconnect: its stream buffer, merged into the transcript shown. For a Run streaming in
 * the background (on hydration) it comes with the persisted transcript fetched again; for the Run
 * a send follows (after a Host event-stream resync) only the buffer's rows are merged, since that
 * transcript has every earlier row already.
 */

/** How the route follows the Run a reconnect is for: streaming it in the background, or its send. */
type ReconnectFollow = 'background' | 'foreground'

/**
 * Fetches the Run's reconnect buffer (and, in the background, the persisted transcript) and merges
 * them into the shown transcript while the Run is still followed the same way and no later
 * reconnect started. A resync is rebroadcast on every failed re-subscribe; the latest one wins.
 * `withTranscript`: a send's reconnect also reads the persisted transcript, its Run having settled
 * (a resync relayed that settlement), so the transcript may lack what it saved.
 */
export function reconnectActiveRun(
  input: SessionHydrationInput,
  context: SessionHydrationContext,
  follow: ReconnectFollow,
  withTranscript = follow === 'background',
) {
  context.reconnectGenerationRef.current += 1
  const request = {
    sessionId: input.sessionId,
    follow,
    generation: context.reconnectGenerationRef.current,
  }
  const shownMessages = () => getMessagesForSession(context.messagesBySessionIdRef, input.sessionId)
  const merge = (result: ReconnectedRun | null) => {
    if (result)
      handleActiveRunReconnectResult(request, result, input.cachedSettledMessageIds, context)
  }
  const reconnect = withTranscript
    ? reconnectToBackgroundRun(input, shownMessages)
    : api
        .getBackgroundRun(input.sessionId)
        .then((snapshot) => bufferOnly(input.sessionId, snapshot, shownMessages))
  void reconnect.then(merge).catch((reconnectError: unknown) => {
    // A send's own Run reports its failures; a recovery that could not read the buffer is moot.
    if (follow === 'background' && isCurrent(request, context)) {
      handleActiveRunReconnectError(reconnectError, context)
    }
  })
}

interface ReconnectRequest {
  readonly sessionId: SessionId
  readonly follow: ReconnectFollow
  readonly generation: number
}

function isCurrent(
  request: ReconnectRequest,
  context: SessionHydrationContext,
  sameRunBuffered = false,
) {
  const following =
    request.follow === 'background'
      ? sameRunBuffered || context.backgroundReconnectSessionIdRef.current === request.sessionId
      : context.foregroundStreamActiveRef.current &&
        context.foregroundSessionIdRef.current === request.sessionId
  return (
    following &&
    context.reconnectGenerationRef.current === request.generation &&
    context.currentSessionIdRef.current === request.sessionId
  )
}

/**
 * Merges the reconnect into the transcript shown. The rows a settled Run left there are left to
 * the freshly fetched transcript once it holds that Run: hydration may have used an older one that
 * did not, and merging them would put the persisted copy next to them.
 */
function handleActiveRunReconnectResult(
  request: ReconnectRequest,
  reconnect: ReconnectedRun,
  settledMessageIds: ReadonlySet<string> | undefined,
  context: SessionHydrationContext,
) {
  if (!isCurrent(request, context, reconnect.sameRunBuffered)) return
  updateMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    request.sessionId,
    (currentMessages) => {
      // The rows only this renderer still shows: not those the persisted transcript saved.
      const unsaved =
        reconnect.persistedMessages === null
          ? currentMessages
          : withoutSavedRunAnswers(
              unsettledRunMessages({
                persistedMessages: reconnect.persistedMessages,
                cachedMessages: currentMessages,
                settledMessageIds,
                fetchedAfterSettlement: reconnect.persistedFetched,
              }) ?? currentMessages,
              reconnect.persistedMessages,
              {
                shownIds: new Set(currentMessages.map((message) => message.id)),
                ...reconnectedRunScope({ ...reconnect, currentMessages }),
              },
            )
      return mergeBackgroundReconnectMessages(
        reconnect.snapshot
          ? withoutShownRunAnswers(reconnect.messages, reconnect.snapshot, currentMessages)
          : reconnect.messages,
        unsaved,
        {
          earlierMessageIds: earlierReconnectMessageIds(reconnect, unsaved, settledMessageIds),
          userMessageAnchors: reconnect.snapshot
            ? userMessageAnchorsOf(reconnect.snapshot)
            : new Map(),
          ...(reconnect.streamingBaseline
            ? { streamingBaseline: reconnect.streamingBaseline }
            : {}),
        },
      )
    },
    { cacheRunSnapshot: true },
  )
}

function handleActiveRunReconnectError(reconnectError: unknown, context: SessionHydrationContext) {
  context.setError(
    reconnectError instanceof Error ? reconnectError : new Error(String(reconnectError)),
  )
  context.setStatus('error')
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
}

interface ReconnectedRun {
  /** The Run's buffer rows, placed in the fetched transcript in the background. */
  readonly messages: UIMessage[]
  /** The fetched persisted transcript alone; `null` when only the buffer was read. */
  readonly persistedMessages: readonly UIMessage[] | null
  /** Whether it was fetched now, after the settlements hydration knew of, not the shown one. */
  readonly persistedFetched: boolean
  /** `null` when the Run's buffer was gone: the persisted transcript alone is merged. */
  readonly snapshot: BackgroundRunSnapshot | null
  /** The buffer read before the detail when its Run settled before the second buffer read. */
  readonly settledBuffer?: BackgroundRunSnapshot
  /**
   * The buffer held the same Run before and after the detail read: the Run has not settled, so
   * its rows still belong in the transcript even if it ended (and stopped being followed)
   * meanwhile; its settlement rehydrates the Session.
   */
  readonly sameRunBuffered?: boolean
  /** The answer the buffer streams, as the transcript showed it when the buffer was read. */
  readonly streamingBaseline?: {
    readonly messageId: string
    readonly parts: readonly UIMessagePart[]
    readonly degraded: boolean
  }
}

/**
 * The buffer, the detail, the buffer again, and the detail once more when the first buffer's Run
 * settled after that read (no buffer left, or the next Run's): the Host saved what the read may
 * lack (that Run's user messages, its start lost in a stall), before the next Run started.
 */
async function readAroundDetail(sessionId: SessionId, shownMessages: () => readonly UIMessage[]) {
  const before = await api.getBackgroundRun(sessionId)
  noteRetainedUserMessages(sessionId, before)
  const fetchedSession = await api.getSessionDetail(sessionId)
  const snapshot = await api.getBackgroundRun(sessionId)
  const streamingBaseline = snapshot ? streamingBaselineOf(snapshot, shownMessages) : undefined
  const sameRun = before?.runId !== undefined && before.runId === snapshot?.runId
  const read = { snapshot, sameRunBuffered: sameRun, streamingBaseline, settledBuffer: undefined }
  if (!before || sameRun || (snapshot && before.runId === undefined))
    return { ...read, fetchedSession }
  return { ...read, fetchedSession: await api.getSessionDetail(sessionId), settledBuffer: before }
}

/**
 * The background reconnect: the buffer, the persisted transcript (a slow Host read), the buffer
 * again (`readAroundDetail`). Answers the transcript saved while this renderer shows them under
 * stream ids (a compaction mid-Run, the Run's end before it settles) are left to the saved copy
 * (`withoutSavedRunAnswers`): merging both showed every answer twice.
 */
async function reconnectToBackgroundRun(
  { sessionId, session, optimisticUserMessages }: SessionHydrationInput,
  shownMessages: () => readonly UIMessage[],
): Promise<ReconnectedRun> {
  const { fetchedSession, snapshot, sameRunBuffered, streamingBaseline, settledBuffer } =
    await readAroundDetail(sessionId, shownMessages)
  const latestSession = fetchedSession ?? session
  const persistedMessages = sessionToUIMessages(latestSession)
  const historicalMessages = mergeSessionAndOptimisticMessages(
    latestSession,
    optimisticUserMessages,
  )
  const settled = settledBuffer ? { settledBuffer } : {}
  const read = { persistedMessages, persistedFetched: fetchedSession !== null, ...settled }
  if (!snapshot) return { messages: historicalMessages, ...read, snapshot: null }
  const partialAssistant = partialAssistantOf(snapshot)
  // The Run's answers the persisted transcript holds already (its end before it settled) are left
  // to their saved copies, each saved answer once.
  const answers = withoutSavedRunAnswers(
    [...earlierAnswersOf(snapshot), ...(partialAssistant ? [partialAssistant] : [])],
    persistedMessages,
    runScopeOf(snapshot),
  )
  const unsavedPartial = answers.find((answer) => answer.id === partialAssistant?.id) ?? null
  const earlierAnswers = answers.filter((answer) => answer !== unsavedPartial)
  return {
    messages: placeReconnectedRunMessages(
      historicalMessages,
      snapshot,
      unsavedPartial,
      earlierAnswers,
    ),
    ...read,
    snapshot,
    sameRunBuffered,
    ...(streamingBaseline ? { streamingBaseline } : {}),
  }
}

/** The foreground reconnect: only the buffer's rows, which the stream may have lost. */
function bufferOnly(
  sessionId: SessionId,
  snapshot: BackgroundRunSnapshot | null,
  shownMessages: () => readonly UIMessage[],
): ReconnectedRun | null {
  if (!snapshot) return null
  noteRetainedUserMessages(sessionId, snapshot)
  const streamingBaseline = streamingBaselineOf(snapshot, shownMessages)
  return {
    messages: placeReconnectedRunMessages(
      [],
      snapshot,
      partialAssistantOf(snapshot),
      earlierAnswersOf(snapshot),
    ),
    persistedMessages: null,
    persistedFetched: false,
    snapshot,
    ...(streamingBaseline ? { streamingBaseline } : {}),
  }
}

/**
 * The buffer's user messages tell a promoted steer's preview when Pi incorporated it, as their
 * events would have (`useBackgroundRunMonitor`): the stream may have lost them, and the preview
 * then stands in for the row at that time while the rest of the reconnect is read.
 */
function noteRetainedUserMessages(sessionId: SessionId, snapshot: BackgroundRunSnapshot | null) {
  const steers = useOptimisticSteerStore.getState()
  for (const retained of snapshot?.userMessages ?? []) {
    const { messageId, timestamp, afterAssistantMessageId: _after, ...userMessage } = retained
    const event = {
      type: 'message_start',
      messageId,
      role: 'user',
      userMessage,
      timestamp,
    } as const
    steers.noteIncorporated(sessionId, incorporatedUserRow(event))
  }
}
