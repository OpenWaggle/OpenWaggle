import { Buffer } from 'node:buffer'
import { TERMINAL } from '@shared/constants/resource-limits'
import { retainTerminalHistorySuffix } from './terminal-history-retention'
import { stripTerminalReplaySequences } from './terminal-history-sanitizer'

const COLD_REPLAY_RESERVED_LINES = 2
const COLD_REPLAY_TRAILING_LINE_BREAK = '\r\n'

/**
 * Restores a predictable primary-screen state without erasing the transcript.
 * DECSTR and the explicit resets cover SGR, origin/insert/mouse/paste/keypad/
 * keyboard modes, character sets, hyperlinks, and a stale DECSTBM region.
 */
export const COLD_REPLAY_STATE_BOUNDARY = [
  '\x1b[0m',
  '\x1b[!p',
  '\x1b[r',
  '\x1b[?6l',
  '\x1b[?25h',
  '\x1b[?1000;1002;1003;1005;1006;1015l',
  '\x1b[?2004l',
  '\x1b[4l',
  '\x1b[>4;0m',
  '\x1b[=0u',
  '\x1b(B',
  '\x0f',
  '\x1b>',
  '\x1b]8;;\x1b\\',
].join('')

export const PREVIOUS_TERMINAL_SESSION_SEPARATOR =
  '\x1b[2m── Previous terminal session ──\x1b[0m\r\n'

/**
 * Builds a bounded, inert transcript for a fresh emulator/PTY generation.
 * The historical body comes first: even an unrecognized old control cannot
 * erase or restyle the boundary label or leak state into the new prompt.
 */
export function coldTerminalReplay(history: string) {
  if (history.length === 0) return ''
  const sanitized = stripTerminalReplaySequences(history)
  const reservedBytes = Buffer.byteLength(
    COLD_REPLAY_TRAILING_LINE_BREAK +
      COLD_REPLAY_STATE_BOUNDARY +
      PREVIOUS_TERMINAL_SESSION_SEPARATOR,
    'utf8',
  )
  const body = retainTerminalHistorySuffix(
    sanitized,
    TERMINAL.MAX_SCROLLBACK_LINES - COLD_REPLAY_RESERVED_LINES,
    TERMINAL.MAX_SCROLLBACK_BYTES - reservedBytes,
  ).text
  const trailingLineBreak = body.endsWith('\n') ? '' : COLD_REPLAY_TRAILING_LINE_BREAK
  return body + trailingLineBreak + COLD_REPLAY_STATE_BOUNDARY + PREVIOUS_TERMINAL_SESSION_SEPARATOR
}
