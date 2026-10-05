import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import { placeReconnectedRunMessages } from '../lib/chat-stream-user-messages'
import {
  reconnectedRunStartOrder,
  runStartOrderOf,
  withoutShownRunAnswers,
} from '../lib/reconnect-run-scope'
import { unsettledRunMessages, withoutSavedRunAnswers } from '../lib/seeded-run-messages'
import {
  buildPartialAssistantMessage,
  mergeBackgroundReconnectMessages,
  sessionToUIMessages,
} from '../lib/useAgentChat.utils'
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
 */
export function reconnectActiveRun(
  input: SessionHydrationInput,
  context: SessionHydrationContext,
  follow: ReconnectFollow,
) {
  context.reconnectGenerationRef.current += 1
  const request = {
    sessionId: input.sessionId,
    follow,
    generation: context.reconnectGenerationRef.current,
  }
  const shownMessages = () => getMessagesForSession(context.messagesBySessionIdRef, input.sessionId)
  const reconnect =
    follow === 'background'
      ? reconnectToBackgroundRun(
          input.sessionId,
          input.session,
          input.optimisticUserMessages,
          shownMessages,
        )
      : reconnectToForegroundRun(input.sessionId, shownMessages)
  void reconnect
    .then((result) => {
      if (result)
        handleActiveRunReconnectResult(request, result, input.cachedSettledMessageIds, context)
    })
    .catch((reconnectError: unknown) => {
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
    (currentMessages) =>
      mergeBackgroundReconnectMessages(
        reconnect.snapshot
          ? withoutShownRunAnswers(reconnect.messages, reconnect.snapshot, currentMessages)
          : reconnect.messages,
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
                fromOrder: reconnectedRunStartOrder({
                  ...reconnect,
                  currentMessages,
                  settledMessageIds,
                }),
              },
            ),
        {
          earlierMessageIds: new Set([
            ...(reconnect.persistedMessages ?? []).map((message) => message.id),
            ...(reconnect.snapshot ? leadingUserMessageIdsOf(reconnect.snapshot) : []),
          ]),
          userMessageAnchors: reconnect.snapshot
            ? userMessageAnchorsOf(reconnect.snapshot)
            : new Map(),
          ...(reconnect.streamingBaseline
            ? { streamingBaseline: reconnect.streamingBaseline }
            : {}),
        },
      ),
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
  }
}

function leadingUserMessageIdsOf(snapshot: BackgroundRunSnapshot) {
  return (snapshot.userMessages ?? []).flatMap((userMessage) =>
    userMessage.afterAssistantMessageId === undefined ? [userMessage.messageId] : [],
  )
}

/**
 * The answer each user message the Run incorporated followed: the one the buffer was streaming.
 * A message incorporated before the Run's first answer has none; it is a leading one.
 */
function userMessageAnchorsOf(snapshot: BackgroundRunSnapshot) {
  const anchors = new Map<string, string>()
  for (const userMessage of snapshot.userMessages ?? []) {
    if (userMessage.afterAssistantMessageId !== undefined) {
      anchors.set(userMessage.messageId, userMessage.afterAssistantMessageId)
    }
  }
  return anchors
}

/**
 * What the transcript shows of the answer the buffer streams. Read when the buffer's answer
 * arrives: the main process sends the events it buffered before that answer, in order.
 */
function streamingBaselineOf(
  snapshot: BackgroundRunSnapshot,
  shownMessages: () => readonly UIMessage[],
) {
  const messageId = snapshot.messageId
  if (messageId === undefined) return undefined
  const shown = shownMessages().find((message) => message.id === messageId)
  return { messageId, parts: shown?.parts ?? [] }
}

/**
 * The answer the buffer streams, dated by Host time like the answers the stream started: no
 * earlier than the Run's start and the user messages it incorporated before the answer. The
 * renderer's own clock, when the reconnect lands, would date it after steers Pi took later.
 */
function partialAssistantOf(snapshot: BackgroundRunSnapshot) {
  const partial = buildPartialAssistantMessage(snapshot.parts, snapshot.messageId)
  if (!partial) return null
  const before = (snapshot.userMessages ?? []).flatMap((userMessage) =>
    userMessage.afterAssistantMessageId === snapshot.messageId ? [] : [userMessage.timestamp],
  )
  return { ...partial, createdAt: new Date(Math.max(snapshot.startedAt, ...before)) }
}

/**
 * The background reconnect: the buffer, the persisted transcript (a slow Host read), the buffer
 * again. `null` when another Run's buffer replaced the first meanwhile: the transcript may predate
 * the first Run's save, and that Run's rows would land below the next Run's prompt. Answers the
 * transcript saved while this renderer shows them under stream ids (a compaction mid-Run, the
 * Run's end before it settles) are left to the saved copy (`withoutSavedRunAnswers`): merging
 * both showed every answer twice.
 */
async function reconnectToBackgroundRun(
  sessionId: SessionId,
  session: SessionDetail,
  optimisticUserMessages: readonly UIMessage[],
  shownMessages: () => readonly UIMessage[],
): Promise<ReconnectedRun | null> {
  const before = await api.getBackgroundRun(sessionId)
  const fetchedSession = await api.getSessionDetail(sessionId)
  const latestSession = fetchedSession ?? session
  const snapshot = await api.getBackgroundRun(sessionId)
  const persistedMessages = sessionToUIMessages(latestSession)
  const historicalMessages = mergeSessionAndOptimisticMessages(
    latestSession,
    optimisticUserMessages,
  )
  const persistedFetched = fetchedSession !== null
  if (!snapshot) {
    return { messages: historicalMessages, persistedMessages, persistedFetched, snapshot: null }
  }
  const streamingBaseline = streamingBaselineOf(snapshot, shownMessages)
  if (before && before.runId !== undefined && before.runId !== snapshot.runId) return null
  const partialAssistant = partialAssistantOf(snapshot)
  const unsavedPartial = partialAssistant
    ? (withoutSavedRunAnswers([partialAssistant], persistedMessages, {
        fromOrder: runStartOrderOf(snapshot) ?? Number.POSITIVE_INFINITY,
      })[0] ?? null)
    : null
  return {
    messages: placeReconnectedRunMessages(historicalMessages, snapshot, unsavedPartial),
    persistedMessages,
    persistedFetched,
    snapshot,
    sameRunBuffered: before?.runId !== undefined && before.runId === snapshot.runId,
    ...(streamingBaseline ? { streamingBaseline } : {}),
  }
}

/** The foreground reconnect: only the buffer's rows, which the stream may have lost. */
async function reconnectToForegroundRun(
  sessionId: SessionId,
  shownMessages: () => readonly UIMessage[],
): Promise<ReconnectedRun | null> {
  const snapshot = await api.getBackgroundRun(sessionId)
  if (!snapshot) return null
  const streamingBaseline = streamingBaselineOf(snapshot, shownMessages)
  return {
    messages: placeReconnectedRunMessages([], snapshot, partialAssistantOf(snapshot)),
    persistedMessages: null,
    persistedFetched: false,
    snapshot,
    ...(streamingBaseline ? { streamingBaseline } : {}),
  }
}
