import type { SessionId as SessionIdType } from '@shared/types/brand'
import { SessionId } from '@shared/types/brand'
import type { SendFailureDisposition } from '@/features/composer/hooks'
import {
  FirstSendFailed,
  isPiSessionFileRefusal,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
} from './message-delivery'

/** The toast for a send refused because the Session's Pi file cannot be used. */
export const PI_SESSION_FILE_REFUSAL_NOTICE =
  'Not sent: this Session cannot be continued. Your message is back in the composer.'

interface SendFailureOwnershipInput {
  readonly cause: unknown
  readonly activeSessionId: SessionIdType | null
  readonly activeDraftContextKey: string | null
  readonly savedDraftContextKeys: readonly string[]
  readonly disposedSessions: ReadonlySet<SessionIdType>
  readonly hasWorktreeLaunch: (sessionId: SessionIdType) => boolean
}

export function sessionImageSendFailureDisposition(
  input: SendFailureOwnershipInput,
): SendFailureDisposition {
  if (input.cause instanceof FirstSendFailed) {
    if (input.cause.cause instanceof MessageDeliveredRunFailed) return { kind: 'retain' }
    const createdSessionId = SessionId(input.cause.createdSessionId)
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
    return { kind: 'restore', contextKey: ownedContextKey }
  }
  if (input.cause instanceof MessageDeliveredRunFailed) return { kind: 'retain' }
  // The Session's notice says why; the text goes back to the composer, and a toast says so.
  if (input.cause instanceof MessageNotDelivered && isPiSessionFileRefusal(input.cause)) {
    return { kind: 'restore', notice: PI_SESSION_FILE_REFUSAL_NOTICE }
  }
  if (input.activeSessionId && input.disposedSessions.has(input.activeSessionId)) {
    return { kind: 'discard' }
  }
  return { kind: 'restore' }
}
