import { SessionControlRejectedError } from '@/features/chat/hooks'
import type { draftBusyReason } from '../state/composer-activity-store'

const BEGIN_REJECTION_COPY: Readonly<Record<string, string>> = {
  follow_up_edit_held: 'This queued message is already being edited.',
  follow_up_not_found: 'This queued message was already sent or removed.',
  follow_up_not_editable: 'Only messages you queued yourself can be edited.',
  follow_up_edit_requires_desktop_user: 'Queued messages can only be edited in the desktop app.',
}

/** Why an edit cannot begin right now, in the user's words. */
export const BEGIN_BLOCK_COPY = {
  editing: 'Finish or cancel the queued message you are editing first.',
  preparing: 'Wait for the attachment to finish preparing, then edit.',
  submitting: 'Wait for your last message to be queued, then edit.',
  'branch-summary': 'Finish or cancel the branch summary first.',
  loading: 'The composer is still loading this Session. Try again in a moment.',
} as const

/** Why a save waits on composer work, in the user's words. */
export const SAVE_BUSY_COPY = {
  preparing: 'Wait for the attachment to finish preparing, then save.',
  submitting: 'Wait for your last message to be queued, then save.',
} as const satisfies Record<NonNullable<ReturnType<typeof draftBusyReason>>, string>

export const LOST_EDIT_MESSAGE =
  'This queued message was already sent or removed, so your edit was not saved. Your text is back in the composer to send as a new message.'
export const NOT_EDITABLE_MESSAGE =
  'This queued message can no longer be edited, so it stays queued as it was. Your text is in the composer if you want to send it as well.'
export const INTERRUPTED_EDIT_MESSAGE = 'Your edit was interrupted; press Enter to save again.'
export const WITHDRAWN_EDIT_MESSAGE =
  'The queued message was removed. Your edited text is back in the composer.'

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function beginFailureMessage(error: unknown) {
  if (error instanceof SessionControlRejectedError) {
    return BEGIN_REJECTION_COPY[error.code] ?? 'This queued message cannot be edited right now.'
  }
  return errorMessage(error)
}

export function saveFailureMessage(error: unknown) {
  // Not a Host answer (a refused GUI-only command, a broken connection): its own words fit.
  if (!(error instanceof SessionControlRejectedError)) return errorMessage(error)
  if (error.code === 'queue_byte_capacity_reached') {
    return 'The edited message is too large for the queue. Shorten it or remove attachments.'
  }
  return 'The edit could not be saved. Try again.'
}
