/**
 * Moving focus to a pending request without disturbing the composer.
 *
 * The request ribbon deliberately never steals focus when it appears, so a sentence in progress
 * survives its arrival. That leaves a keyboard-only user with no route to the decision other than
 * tabbing forward through the page, which is what this closes.
 *
 * Focus goes to the request's first control, never to a decision, and Escape returns the caret to
 * wherever it was, mid-word. No key is bound to a grant action: a mistyped chord must not be able to
 * grant a capability.
 */

const RIBBON_SELECTOR = '[data-request-ribbon="true"]'
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The composer input, used as the fallback focus target.
 *
 * A user who tabbed to the request rather than using the shortcut left no remembered caret, and a
 * decision still has to hand focus somewhere useful. `<body>` is not useful: Escape stops working
 * and the next Tab restarts from the top of the document.
 */
const COMPOSER_INPUT_SELECTOR = '[data-chat-composer-form] [aria-label="Message input"]'

let returnTarget: HTMLElement | null = null

/**
 * Focuses the first control of a pending request.
 *
 * Returns whether anything was focused, so a caller can leave the keystroke to other handlers when
 * no request is waiting rather than swallowing it.
 */
export function focusPendingRequest(): boolean {
  const ribbon = document.querySelector(RIBBON_SELECTOR)
  if (!ribbon) return false

  const target = ribbon.querySelector(FOCUSABLE_SELECTOR)
  if (!(target instanceof HTMLElement)) return false

  const active = document.activeElement
  returnTarget = active instanceof HTMLElement ? active : null
  target.focus()
  return true
}

/**
 * Returns focus to wherever it was before the request was reached.
 *
 * Falls back to the composer input when nothing was remembered, so answering a request always lands
 * the caret somewhere the user can keep typing.
 */
export function restoreFocusBeforeRequest(): void {
  const target = returnTarget
  returnTarget = null
  if (target?.isConnected) {
    target.focus()
    return
  }

  const composer = document.querySelector(COMPOSER_INPUT_SELECTOR)
  if (composer instanceof HTMLElement) composer.focus()
}

/** Clears the remembered caret position, for tests. */
export function clearPendingRequestFocusMemoryForTests(): void {
  returnTarget = null
}
