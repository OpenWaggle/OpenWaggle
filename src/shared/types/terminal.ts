/**
 * Terminal domain types shared between main, preload, and renderer.
 *
 * Every terminal is a Session terminal (ADR 0030): it belongs to exactly one
 * terminal owner — a durable session or the pre-send draft — and its shell
 * starts in that owner's Working path.
 */

/**
 * Owner of a terminal group: a durable session id, or a draft key
 * (`draft:<projectPath>`) while the session has not been created by first send.
 */
export type TerminalOwnerKey = string

/** Client-chosen terminal id, unique within one Terminal owner key. */
export type TerminalId = string

/** Stable identity of one terminal across restarts: `<ownerKey>::<terminalId>`. */
export type TerminalKey = string

/** Input that (re)opens a terminal. Idempotent: same launch context reuses the live shell. */
export interface TerminalOpenInput {
  readonly ownerKey: TerminalOwnerKey
  readonly terminalId: TerminalId
  /** Absolute working path the shell starts in — the owner's Working path. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
}

export interface TerminalAttachResult {
  /**
   * Persisted scrollback replay for the terminal, already sanitized so replay
   * never re-triggers terminal query sequences. Empty for a brand-new terminal.
   */
  readonly history: string
  /**
   * Cumulative output-stream bytes covered by `history`. Live `output` events
   * carry start/end offsets into the same stream, so a pane drops the parts of
   * an event it already received via the replay instead of writing them twice.
   */
  readonly outputBytes: number
  /** Whether a live shell process is running or a spawn was just requested. */
  readonly running: boolean
  /** Present when no shell is running and the Working path no longer exists. */
  readonly cwdMissing?: boolean
  /** Exit code of the last dead shell, when `running` is false and cwd exists. */
  readonly exitCode?: number
}

export type TerminalRuntimeEvent =
  | {
      readonly type: 'output'
      readonly data: string
      /** Stream offset of `data`'s first byte. */
      readonly startOffset: number
      /** Stream offset just past `data`'s last byte. */
      readonly endOffset: number
    }
  | { readonly type: 'exited'; readonly exitCode: number }
  | { readonly type: 'closed' }
  | { readonly type: 'cleared' }
  | { readonly type: 'activity'; readonly processName: string | null }
  | { readonly type: 'ports'; readonly ports: readonly number[] }

export interface TerminalEventPayload {
  readonly ownerKey: TerminalOwnerKey
  readonly terminalId: TerminalId
  readonly event: TerminalRuntimeEvent
}

export function terminalKeyOf(ownerKey: TerminalOwnerKey, terminalId: TerminalId): TerminalKey {
  return `${ownerKey}::${terminalId}`
}
