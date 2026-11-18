import {
  type AssistantMessage,
  isContextOverflow,
  isRetryableAssistantError,
} from '@earendil-works/pi-ai'

/**
 * Whether a Waggle turn's final error can recover on a later turn, by Pi's own rules. A transient
 * provider or network error (Pi already retried it) can; a rejected or expired sign-in, a missing
 * model, exhausted quota or billing, and a context overflow Pi could not compact away would fail
 * every turn, so they stop the collaboration.
 */
export function isRecoverableWaggleTurnError(message: AssistantMessage) {
  return !isContextOverflow(message) && isRetryableAssistantError(message)
}
