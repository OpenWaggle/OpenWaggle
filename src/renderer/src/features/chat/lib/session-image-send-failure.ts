import type { SessionId as SessionIdType } from '@shared/types/brand'
import { SessionId } from '@shared/types/brand'
import type { SendFailureDisposition } from '@/features/composer/hooks'
import {
  FirstSendFailed,
  isPiSessionFileRefusal,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
  refusalSummary,
  SendFailedOutOfView,
  sendRefusalOf,
} from './message-delivery'

/** The toast for a send refused because the Session's Pi file cannot be used. */
export const PI_SESSION_FILE_REFUSAL_NOTICE =
  'Not sent: this Session cannot be continued. Your message is back in the composer.'

/**
 * The toast for any other send the Session Host refused. Without it the message came back to the
 * composer with no word of why, which read as the app ignoring the person.
 */
export function refusedSendNotice(refusal: MessageNotDelivered) {
  return `${refusalSummary(refusal)} Your message is back in the composer.`
}

/** The toast for a send whose call failed while another send's Run owned the Session's status. */
export function failedOutOfViewNotice(failure: SendFailedOutOfView) {
  const reason = failure.message.replace(/\.$/u, '')
  return `Could not send: ${reason || 'the app could not reach the Session Host'}. Your message is back in the composer.`
}

type RestoreNotice = Pick<
  Extract<SendFailureDisposition, { kind: 'restore' }>,
  'notice' | 'unexpected'
>

/** What the person is told about an undelivered send the Session does not show, if anything. */
function undeliveredNotice(cause: unknown) {
  const failure = cause instanceof FirstSendFailed ? cause.cause : cause
  if (failure instanceof SendFailedOutOfView) {
    return { notice: failedOutOfViewNotice(failure), unexpected: true } satisfies RestoreNotice
  }
  const refusal = sendRefusalOf(cause)
  return (refusal ? { notice: refusedSendNotice(refusal) } : {}) satisfies RestoreNotice
}

interface SendFailureOwnershipInput {
  readonly cause: unknown
  readonly activeSessionId: SessionIdType | null
  readonly activeDraftContextKey: string | null
  readonly savedDraftContextKeys: readonly string[]
  readonly disposedSessions: ReadonlySet<SessionIdType>
  readonly hasWorktreeLaunch: (sessionId: SessionIdType) => boolean
}

/** A failed first send: its draft belongs to the Session it created, unless the agent got it. */
function firstSendFailureDisposition(cause: FirstSendFailed, input: SendFailureOwnershipInput) {
  if (cause.cause instanceof MessageDeliveredRunFailed) {
    return { kind: 'retain' } satisfies SendFailureDisposition
  }
  const createdSessionId = SessionId(cause.createdSessionId)
  if (input.disposedSessions.has(createdSessionId)) {
    return { kind: 'discard' } satisfies SendFailureDisposition
  }
  if (input.hasWorktreeLaunch(createdSessionId)) {
    return { kind: 'retain' } satisfies SendFailureDisposition
  }
  const sessionContextToken = `:session:${String(createdSessionId)}:`
  const savedOwnedContextKey =
    input.savedDraftContextKeys.find(
      (key) => key.includes(sessionContextToken) && key.endsWith(':main'),
    ) ?? input.savedDraftContextKeys.find((key) => key.includes(sessionContextToken))
  const activeOwnedContextKey = input.activeDraftContextKey?.includes(sessionContextToken)
    ? input.activeDraftContextKey
    : null
  const ownedContextKey =
    activeOwnedContextKey ?? savedOwnedContextKey ?? `session:${String(createdSessionId)}:pending`
  return {
    kind: 'restore',
    contextKey: ownedContextKey,
    ...undeliveredNotice(cause),
  } satisfies SendFailureDisposition
}

export function sessionImageSendFailureDisposition(input: SendFailureOwnershipInput) {
  if (input.cause instanceof FirstSendFailed) {
    return firstSendFailureDisposition(input.cause, input) satisfies SendFailureDisposition
  }
  if (input.cause instanceof MessageDeliveredRunFailed) {
    return { kind: 'retain' } satisfies SendFailureDisposition
  }
  // The Session's notice says why; the text goes back to the composer, and a toast says so.
  if (input.cause instanceof MessageNotDelivered && isPiSessionFileRefusal(input.cause)) {
    return {
      kind: 'restore',
      notice: PI_SESSION_FILE_REFUSAL_NOTICE,
    } satisfies SendFailureDisposition
  }
  if (input.activeSessionId && input.disposedSessions.has(input.activeSessionId)) {
    return { kind: 'discard' } satisfies SendFailureDisposition
  }
  return { kind: 'restore', ...undeliveredNotice(input.cause) } satisfies SendFailureDisposition
}
