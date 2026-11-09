import type { SessionId as SessionIdType } from '@shared/types/brand'
import { SessionId } from '@shared/types/brand'
import type { SendFailureDisposition } from '@/features/composer/hooks'
import {
  DEFAULT_NOT_DELIVERED_MESSAGE,
  FirstSendFailed,
  isPiSessionFileRefusal,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
} from './message-delivery'

/** The toast for a send refused because the Session's Pi file cannot be used. */
export const PI_SESSION_FILE_REFUSAL_NOTICE =
  'Not sent: this Session cannot be continued. Your message is back in the composer.'

/** What the Session Host's refusal codes a person's send can still meet mean, in plain words. */
const REFUSAL_REASONS = new Map([
  ['queue_capacity_reached', 'this Session already has as many queued messages as it can hold'],
  ['queue_byte_capacity_reached', 'this Session’s queued messages are already as large as allowed'],
  ['follow_up_reserved', 'a steered message is still being delivered to the running agent'],
])

/**
 * The toast for any other send the Session Host refused. Without it the message came back to the
 * composer with no word of why, which read as the app ignoring the person. The Host's own words
 * come first when it wrote some, then what its code means; the code is kept for support.
 */
export function refusedSendNotice(refusal: MessageNotDelivered) {
  const { code, message } = refusal
  const readable = message !== DEFAULT_NOT_DELIVERED_MESSAGE && message !== code
  const written = readable ? (message.endsWith('.') ? message.slice(0, -1) : message) : undefined
  const reason = written ?? (code ? REFUSAL_REASONS.get(code) : undefined)
  const suffix = 'Your message is back in the composer.'
  if (reason)
    return code ? `Not sent: ${reason} (${code}). ${suffix}` : `Not sent: ${reason}. ${suffix}`
  return code ? `Not sent: the Session Host refused it (${code}). ${suffix}` : `Not sent. ${suffix}`
}

function refusalOf(cause: unknown) {
  const refusal = cause instanceof FirstSendFailed ? cause.cause : cause
  return refusal instanceof MessageNotDelivered && refusal.outcome === 'refused'
    ? refusal
    : undefined
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
function firstSendFailureDisposition(
  cause: FirstSendFailed,
  input: SendFailureOwnershipInput,
): SendFailureDisposition {
  if (cause.cause instanceof MessageDeliveredRunFailed) return { kind: 'retain' }
  const createdSessionId = SessionId(cause.createdSessionId)
  if (input.disposedSessions.has(createdSessionId)) return { kind: 'discard' }
  if (input.hasWorktreeLaunch(createdSessionId)) return { kind: 'retain' }
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
  const refusal = refusalOf(cause)
  return {
    kind: 'restore',
    contextKey: ownedContextKey,
    ...(refusal ? { notice: refusedSendNotice(refusal) } : {}),
  }
}

export function sessionImageSendFailureDisposition(
  input: SendFailureOwnershipInput,
): SendFailureDisposition {
  if (input.cause instanceof FirstSendFailed) return firstSendFailureDisposition(input.cause, input)
  if (input.cause instanceof MessageDeliveredRunFailed) return { kind: 'retain' }
  // The Session's notice says why; the text goes back to the composer, and a toast says so.
  if (input.cause instanceof MessageNotDelivered && isPiSessionFileRefusal(input.cause)) {
    return { kind: 'restore', notice: PI_SESSION_FILE_REFUSAL_NOTICE }
  }
  if (input.activeSessionId && input.disposedSessions.has(input.activeSessionId)) {
    return { kind: 'discard' }
  }
  const refusal = refusalOf(input.cause)
  return refusal ? { kind: 'restore', notice: refusedSendNotice(refusal) } : { kind: 'restore' }
}
