/**
 * jsdom has no `showModal()`. This stand-in also runs the part of the native dialog focusing steps
 * that matters to command dialogs: focus moves to the first focusable descendant, so a test catches
 * a dialog whose pointer-only controls would take focus from its search field in Chromium.
 */
export function installModalDialogStub() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
    this.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]',
    )?.focus()
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
}
