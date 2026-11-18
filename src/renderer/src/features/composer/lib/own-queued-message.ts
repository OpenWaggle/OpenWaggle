import { isLocalUserCallerId } from '@shared/utils/local-user-caller'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'

/**
 * A queued message the Host sends as this user (`isPersonStartedRun`): one they queued, or one
 * adopted with Send as me or sent from the CLI as them.
 */
export function isOwnQueuedMessage(item: Pick<SessionFollowUpQueueItem, 'editable' | 'callerId'>) {
  return item.editable || (item.callerId !== undefined && isLocalUserCallerId(item.callerId))
}
