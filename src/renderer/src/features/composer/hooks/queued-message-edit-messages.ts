import { SessionControlRejectedError } from '@/features/chat/hooks'

const BEGIN_REJECTION_COPY: Readonly<Record<string, string>> = {
  follow_up_edit_held: 'This queued message is already being edited.',
  follow_up_not_found: 'This queued message was already sent or removed.',
  follow_up_not_editable: 'Only messages you queued yourself can be edited.',
  follow_up_edit_requires_desktop_user: 'Queued messages can only be edited in the desktop app.',
}

export const LOST_EDIT_MESSAGE =
  'This queued message was already sent or removed, so your edit was not saved. Your text is back in the composer to send as a new message.'
export const DROPPED_ATTACHMENTS_SUFFIX = ' Attach new files again if you need them.'

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
