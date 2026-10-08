import type { BackgroundRunSnapshot, BackgroundRunUserMessage } from '@shared/types/background-run'
import type { UIMessage } from '@shared/types/chat-ui'
import type {
  AgentTransportMessageStartEvent,
  AgentTransportUserMessage,
} from '@shared/types/stream'
import { messagePartToUIParts } from './chat-message-conversion'
import { getUIMessageText } from './chat-message-text'

function incorporatedUserMetadata(userMessage: AgentTransportUserMessage) {
  return {
    sessionNodeCreatedOrder: userMessage.sessionNodeCreatedOrder,
    ...(userMessage.durableTextSha256 ? { durableTextSha256: userMessage.durableTextSha256 } : {}),
    ...(userMessage.waggleInvocation ? { waggleInvocation: userMessage.waggleInvocation } : {}),
  }
}

/** Whether a transcript row is this incorporated message: its log order, with its content. */
function isSameIncorporatedMessage(
  message: UIMessage,
  incorporated: UIMessage,
  userMessage: AgentTransportUserMessage,
) {
  if (message.role !== 'user') return false
  if (message.metadata?.sessionNodeCreatedOrder !== userMessage.sessionNodeCreatedOrder)
    return false
  const digest = userMessage.durableTextSha256
  return (
    (digest !== undefined && message.metadata?.durableTextSha256 === digest) ||
    getUIMessageText(message) === getUIMessageText(incorporated)
  )
}

/** A user row this renderer shows before the Host has recorded it: an optimistic send. */
function isUnrecordedUserMessage(message: UIMessage) {
  return message.role === 'user' && message.metadata?.sessionNodeCreatedOrder === undefined
}

/** The transcript row of a user message the Run has started incorporating. */
export function incorporatedUserRow(
  event: AgentTransportMessageStartEvent & { readonly userMessage: AgentTransportUserMessage },
): UIMessage {
  return {
    id: event.messageId,
    role: 'user',
    parts: event.userMessage.parts.flatMap(messagePartToUIParts),
    createdAt: new Date(event.timestamp),
    metadata: { ...incorporatedUserMetadata(event.userMessage), liveIncorporated: true },
  }
}

/**
 * Shows a user message the Run has started incorporating. A send the renderer already shows
 * optimistically takes the message's log identity instead of being repeated, and a message the
 * transcript already holds is left as it is.
 */
export function applyIncorporatedUserMessage(
  messages: readonly UIMessage[],
  event: AgentTransportMessageStartEvent & { readonly userMessage: AgentTransportUserMessage },
): UIMessage[] {
  const { userMessage } = event
  const incorporated = incorporatedUserRow(event)
  const alreadyShown = messages.some(
    (message) =>
      message.id === event.messageId ||
      isSameIncorporatedMessage(message, incorporated, userMessage),
  )
  if (alreadyShown) return [...messages]

  const text = getUIMessageText(incorporated)
  const optimisticIndex = text
    ? messages.findIndex(
        (message) => isUnrecordedUserMessage(message) && getUIMessageText(message) === text,
      )
    : -1
  const optimistic = messages[optimisticIndex]
  if (!optimistic) return [...messages, incorporated]

  const next = [...messages]
  next[optimisticIndex] = {
    ...optimistic,
    metadata: { ...optimistic.metadata, ...incorporatedUserMetadata(userMessage) },
  }
  return next
}

function applyRetainedUserMessages(
  messages: readonly UIMessage[],
  userMessages: readonly BackgroundRunUserMessage[],
): UIMessage[] {
  return userMessages.reduce<UIMessage[]>(
    (current, { messageId, timestamp, afterAssistantMessageId: _after, ...userMessage }) =>
      applyIncorporatedUserMessage(current, {
        type: 'message_start',
        messageId,
        role: 'user',
        userMessage,
        timestamp,
      }),
    [...messages],
  )
}

/**
 * Rebuilds a reconnected Run's live tail: the user messages it already incorporated and the
 * answers it already finished (`earlierAnswers`, in order), around the answer it is still
 * streaming. A message incorporated after that answer's tools follows it.
 */
export function placeReconnectedRunMessages(
  historicalMessages: readonly UIMessage[],
  snapshot: Pick<BackgroundRunSnapshot, 'messageId' | 'userMessages'>,
  partialAssistant: UIMessage | null,
  earlierAnswers: readonly UIMessage[] = [],
): UIMessage[] {
  const userMessages = snapshot.userMessages ?? []
  const followsPartial = (userMessage: BackgroundRunUserMessage) =>
    partialAssistant !== null &&
    snapshot.messageId !== undefined &&
    userMessage.afterAssistantMessageId === snapshot.messageId
  const earlier = placeEarlierRunMessages(
    historicalMessages,
    userMessages.filter((userMessage) => !followsPartial(userMessage)),
    earlierAnswers,
  )
  return applyRetainedUserMessages(
    partialAssistant ? [...earlier, partialAssistant] : earlier,
    userMessages.filter(followsPartial),
  )
}

/**
 * The Run's user messages and finished answers in the order Pi took them: each user message right
 * after the answer it followed, or (that answer left out of the buffer) after the last one that
 * started before it; one that followed none leads.
 */
function placeEarlierRunMessages(
  messages: readonly UIMessage[],
  userMessages: readonly BackgroundRunUserMessage[],
  answers: readonly UIMessage[],
) {
  if (answers.length === 0) return applyRetainedUserMessages(messages, userMessages)
  const answerIndex = new Map(answers.map((answer, index) => [answer.id, index]))
  const slotOf = (userMessage: BackgroundRunUserMessage) => {
    const anchor = userMessage.afterAssistantMessageId
    if (anchor === undefined) return 0
    const index = answerIndex.get(anchor)
    if (index !== undefined) return index + 1
    const next = answers.findIndex(
      // Same millisecond: Pi takes the user message in before it starts the answer after it.
      (answer) => (answer.createdAt?.getTime() ?? 0) >= userMessage.timestamp,
    )
    return next < 0 ? answers.length : next
  }
  let placed = [...messages]
  for (const [slot, answer] of [...answers, undefined].entries()) {
    placed = applyRetainedUserMessages(
      placed,
      userMessages.filter((userMessage) => slotOf(userMessage) === slot),
    )
    if (answer && !placed.some((message) => message.id === answer.id)) placed.push(answer)
  }
  return placed
}
