import type { TerminalOpenInput } from '@shared/types/terminal'
import {
  normalizeTerminalEnvironment,
  terminalEnvironmentsEqual,
} from '@shared/utils/terminal-environment'
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
  /** Same launch context while the asynchronous shell spawn is still settling. */
  | { readonly kind: 'reuse-spawning' }
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
  const environmentChanged =
    input.env !== undefined &&
    !terminalEnvironmentsEqual(record.env, normalizeTerminalEnvironment(input.env))
  const launchContextChanged = record.cwd !== input.cwd || environmentChanged
  if (
    record.live !== null &&
    record.exitCode === null &&
    record.termination === null &&
    !launchContextChanged
  ) {
    return { kind: 'reuse' }
  }
  if (launchContextChanged) {
    return { kind: 'context-change' }
  }
  // A null live process plus a null exit code is the runtime's explicit
  // "spawn in flight" state. Re-opening during that window must attach to the
  // pending shell instead of incrementing the generation and spawning twice.
  if (record.exitCode === null) return { kind: 'reuse-spawning' }
  return { kind: 'respawn' }
}
