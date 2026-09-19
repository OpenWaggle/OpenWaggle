import type { SessionId as SessionIdType } from '@shared/types/brand'
import { SessionId } from '@shared/types/brand'
import type { SendFailureDisposition } from '@/features/composer/hooks'
import { FirstSendFailed, MessageDeliveredRunFailed } from './message-delivery'

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
  if (input.activeSessionId && input.disposedSessions.has(input.activeSessionId)) {
    return { kind: 'discard' }
  }
  return { kind: 'restore' }
}
