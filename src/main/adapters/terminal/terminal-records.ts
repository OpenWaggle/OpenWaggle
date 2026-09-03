import type { TerminalId, TerminalKey } from '@shared/types/terminal'
import type { IPty } from 'node-pty'
import type { TerminalHistorySanitizer } from './terminal-history-sanitizer'
import type { TerminalScrollback } from './terminal-scrollback'

/**
 * Main-process registry record for one Session terminal (ADR 0030): the shell
 * process while live, plus the scrollback and launch context that survive it.
 */
export interface TerminalRecord {
  readonly key: TerminalKey
  readonly ownerKey: string
  readonly terminalId: TerminalId
  /** Launch context Working path; changes only across respawn. */
  cwd: string
  readonly scrollback: TerminalScrollback
  readonly sanitizer: TerminalHistorySanitizer
  pendingOutput: string
  /** Stream offset before the first byte currently held in pendingOutput. */
  pendingStartOffset: number
  /** Cumulative raw output bytes seen for this terminal's current shell. */
  outputBytes: number
  spawnGeneration: number
  exitCode: number | null
  /** Closed terminals drop further PTY output instead of resurrecting history. */
  closed: boolean
  live: { readonly pty: IPty; readonly pid: number } | null
}
