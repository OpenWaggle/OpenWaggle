import type { TerminalOpenInput } from '@shared/types/terminal'
import type { TerminalRecord } from './terminal-records'

/**
 * Pure re-open semantics (ADR 0030, mirroring t3code's Manager.openLocked):
 * the decision for one open request given the terminal's current state.
 */
export type TerminalOpenDecision =
  /** Working path gone: report, never spawn elsewhere. */
  | { readonly kind: 'cwd-missing'; readonly persisted: string }
  /** New terminal or app-restart recovery: replay persisted scrollback. */
  | { readonly kind: 'create'; readonly persisted: string }
  /** Live shell with the same launch context: reuse and resize. */
  | { readonly kind: 'reuse' }
  /** Launch context changed: kill, reset history, respawn. */
  | { readonly kind: 'context-change' }
  /** Dead shell, same Working path: respawn, replay scrollback. */
  | { readonly kind: 'respawn' }

export function decideTerminalOpen(
  record: TerminalRecord | undefined,
  input: TerminalOpenInput,
  cwdExists: boolean,
  persistedHistory: string,
): TerminalOpenDecision {
  if (!cwdExists) {
    const persisted = record?.scrollback.toString() ?? persistedHistory
    return { kind: 'cwd-missing', persisted }
  }
  if (record === undefined) {
    return { kind: 'create', persisted: persistedHistory }
  }
  if (record.live !== null && record.cwd === input.cwd) {
    return { kind: 'reuse' }
  }
  if (record.live !== null && record.cwd !== input.cwd) {
    return { kind: 'context-change' }
  }
  return { kind: 'respawn' }
}
