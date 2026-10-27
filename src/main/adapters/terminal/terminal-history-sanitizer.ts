/**
 * Strips terminal query sequences from scrollback destined for persistence
 * and replay (ADR 0030, mirroring t3code's history hygiene). The query
 * classifier is shared with the renderer, which scrubs attach history again
 * before replaying it (`@shared/utils/terminal-escape-sequences`, issue #385).
 *
 * Sequences can straddle chunk boundaries, so the sanitizer carries any
 * incomplete escape tail between calls.
 */

import {
  ESCAPE_KIND_CSI,
  type EscapeSequenceKind,
  isTerminalQuerySequence,
  splitAtIncompleteTail,
  stripEscapeSequences,
} from '@shared/utils/terminal-escape-sequences'

const ESC_CODE = 0x1b
const ESC_INTERMEDIATE_MIN = 0x20
const HORIZONTAL_TAB_CODE = 0x09
const LINE_FEED_CODE = 0x0a
const CARRIAGE_RETURN_CODE = 0x0d
const DELETE_CODE = 0x7f
const C1_CONTROL_MAX = 0x9f
/**
 * Bound for an incomplete escape sequence held between chunks. Shell
 * integration OSC payloads (the command being run, its exit code) can be
 * hundreds of bytes, so the hold window must exceed them; only a degenerate
 * stream that never terminates a sequence drops the tail.
 */
const MAX_PENDING_TAIL = 4_096

export interface TerminalHistorySanitizer {
  /** Sanitize one output chunk; carries incomplete sequence tails internally. */
  feed(chunk: string): string
  /**
   * Raw prefix of an escape sequence already counted by the live output
   * stream, but not yet safe to persist. Hot replacement surfaces replay it
   * so the next live chunk can complete the sequence instead of starting in
   * its middle.
   */
  pendingRawTail(): string
}

/**
 * Scrub persisted output before a dead PTY is replayed into a fresh xterm.
 * Live terminal output still carries display modes to the active emulator;
 * cold replay drops modes that could leave the new prompt in alternate-screen,
 * mouse, paste, keyboard-protocol, insert, keypad, or reset state.
 */
export function stripTerminalReplaySequences(text: string) {
  const parts = splitAtIncompleteTail(text)
  return stripUnsafeReplayControlCharacters(
    stripEscapeSequences(parts.complete, isUnsafeReplaySequence),
  )
}

export function createTerminalHistorySanitizer() {
  let tail = ''

  const feed = (chunk: string) => {
    const text = tail + chunk
    tail = ''
    const parts = splitAtIncompleteTail(text)
    const sanitized = stripEscapeSequences(parts.complete, isTerminalQuerySequence)
    if (parts.incomplete.length > 0 && parts.incomplete.length <= MAX_PENDING_TAIL) {
      tail = parts.incomplete
    }
    return sanitized
  }

  return {
    feed,
    pendingRawTail: () => tail,
  }
}

function stripUnsafeReplayControlCharacters(text: string) {
  let output = ''
  for (const character of text) {
    const code = character.charCodeAt(0)
    const retainedWhitespace =
      code === HORIZONTAL_TAB_CODE || code === LINE_FEED_CODE || code === CARRIAGE_RETURN_CODE
    const safeEscapePrefix = code === ESC_CODE
    const c0Control = code < ESC_INTERMEDIATE_MIN
    const deleteOrC1Control = code >= DELETE_CODE && code <= C1_CONTROL_MAX
    if (retainedWhitespace || safeEscapePrefix || (!c0Control && !deleteOrC1Control)) {
      output += character
    }
  }
  return output
}

function isUnsafeReplaySequence(body: string, kind: EscapeSequenceKind, raw: string) {
  // Cold history is presentation, not a live terminal protocol stream. OSC,
  // DCS, and plain ESC commands can mutate title/clipboard/hyperlinks,
  // character sets, keypad mode, or other emulator state. None is required to
  // preserve the readable transcript, so retain them only for a live attach.
  if (kind !== ESCAPE_KIND_CSI) return true
  if (isTerminalQuerySequence(body, kind, raw)) return true

  return !isSafeColdReplayCsi(body, raw)
}

function isSafeColdReplayCsi(body: string, raw: string) {
  const final = raw.slice(-1)
  // Standard SGR is the only stateful sequence worth preserving for a cold
  // transcript. The replay boundary resets it before the new prompt. All
  // cursor, erase, scroll-region, insert/delete, TUI mode, and protocol
  // sequences are discarded, including private `...m` extensions.
  return final === 'm' && /^[0-9:;]*$/.test(body)
}
