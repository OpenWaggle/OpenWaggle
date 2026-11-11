/**
 * Shared vocabulary of the desktop shell ports (ADR 0064). Every port in this directory describes
 * one capability the desktop shell gives the main process, in OpenWaggle's terms.
 * `src/main/adapters/electrobun/` implements them, and passes the contract suites in
 * `src/main/ports/desktop-shell/__tests__/contracts/`.
 */

/** Stops a listener a port registered. Calling it twice is harmless. */
export type Unsubscribe = () => void

/** An event a listener may cancel, such as a quit or a navigation. */
export interface CancellableShellEvent {
  readonly preventDefault: () => void
}
