/**
 * Strips terminal query sequences from scrollback destined for persistence
 * and replay (ADR 0030, mirroring t3code's history hygiene).
 *
 * Programs send queries (DSR, DA, DECRQM, XTVERSION, kitty keyboard, OSC
 * color queries) expecting the terminal emulator to answer. When a captured
 * query is replayed into a fresh terminal, the emulator answers the replay —
 * echoing junk into the shell and stealing input. Stripping the queries from
 * persisted history removes the whole class of replay bugs.
 *
 * Sequences can straddle chunk boundaries, so the sanitizer carries any
 * incomplete escape tail between calls.
 */

const ESC_CODE = 0x1b
const BEL_CODE = 0x07
const ST_ESCAPE_CODE = 0x5c
const CSI_MARKER_CODE = 0x5b
const OSC_MARKER_CODE = 0x5d
const DCS_MARKER_CODE = 0x50
const CSI_FINAL_MIN = 0x40
const CSI_FINAL_MAX = 0x7e
const ESC_INTERMEDIATE_MIN = 0x20
const ESC_INTERMEDIATE_MAX = 0x2f
const ESC_FINAL_MIN = 0x30
const ESC_FINAL_MAX = 0x7e
const HORIZONTAL_TAB_CODE = 0x09
const LINE_FEED_CODE = 0x0a
const CARRIAGE_RETURN_CODE = 0x0d
const DELETE_CODE = 0x7f
const C1_CONTROL_MAX = 0x9f
const ESC_BODY_OFFSET = 2
const ESC_CODE_LENGTH = 1
const ST_LENGTH = 2
/**
 * Bound for an incomplete escape sequence held between chunks. Shell
 * integration OSC payloads (the command being run, its exit code) can be
 * hundreds of bytes, so the hold window must exceed them; only a degenerate
 * stream that never terminates a sequence drops the tail.
 */
const MAX_PENDING_TAIL = 4_096

const ESC = String.fromCharCode(ESC_CODE)

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

/** One-shot scrub for text known to contain no split sequences (tests, replay reads). */
export function stripTerminalQuerySequences(text: string) {
  const parts = splitAtIncompleteTail(text)
  return stripQuerySequences(parts.complete) + parts.incomplete
}

/**
 * Scrub persisted output before a dead PTY is replayed into a fresh xterm.
 * Live terminal output still carries display modes to the active emulator;
 * cold replay drops modes that could leave the new prompt in alternate-screen,
 * mouse, paste, keyboard-protocol, insert, keypad, or reset state.
 */
export function stripTerminalReplaySequences(text: string) {
  const parts = splitAtIncompleteTail(text)
  return stripUnsafeReplayControlCharacters(stripUnsafeReplaySequences(parts.complete))
}

export function createTerminalHistorySanitizer() {
  let tail = ''

  const feed = (chunk: string) => {
    const text = tail + chunk
    tail = ''
    const parts = splitAtIncompleteTail(text)
    const sanitized = stripQuerySequences(parts.complete)
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

function splitAtIncompleteTail(text: string) {
  let cursor = 0
  while (cursor < text.length) {
    const escIndex = text.indexOf(ESC, cursor)
    if (escIndex === -1) return { complete: text, incomplete: '' }
    const sequence = readEscapeSequence(text, escIndex)
    if (sequence === null) {
      return { complete: text.slice(0, escIndex), incomplete: text.slice(escIndex) }
    }
    cursor = sequence.end
  }
  return { complete: text, incomplete: '' }
}

/**
 * Removes query sequences from a complete run of terminal text:
 *
 * - CSI queries with final `n` (DSR/DECRQM) or `c` (primary/secondary DA)
 * - CSI DECRQM queries ending with an intermediate `$` before final `p`
 * - kitty keyboard protocol queries `CSI ? u`
 * - XTVERSION and related `CSI > q` probes
 * - DCS `+q` XTGETTCAP requests
 * - OSC 10/11/12 color queries of the form `OSC nnn ; ? (BEL|ST)`
 */
function stripQuerySequences(text: string) {
  return stripSequences(text, isQuerySequence)
}

function stripUnsafeReplaySequences(text: string) {
  return stripSequences(text, isUnsafeReplaySequence)
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

function stripSequences(
  text: string,
  shouldStrip: (body: string, kind: string, raw: string) => boolean,
) {
  let output = ''
  let cursor = 0

  while (cursor < text.length) {
    const escIndex = text.indexOf(ESC, cursor)
    if (escIndex === -1) {
      output += text.slice(cursor)
      break
    }

    output += text.slice(cursor, escIndex)
    const sequence = readEscapeSequence(text, escIndex)
    if (sequence === null) {
      // Not a recognized sequence shape; keep the ESC byte and move on.
      output += ESC
      cursor = escIndex + ESC_CODE_LENGTH
      continue
    }

    if (!shouldStrip(sequence.body, sequence.kind, sequence.raw)) {
      output += sequence.raw
    }
    cursor = sequence.end
  }

  return output
}

const ESCAPE_KIND_CSI = 'csi'
const ESCAPE_KIND_OSC = 'osc'
const ESCAPE_KIND_DCS = 'dcs'
const ESCAPE_KIND_ESC = 'esc'

interface EscapeSequence {
  readonly raw: string
  readonly body: string
  readonly kind: string
  readonly end: number
}

function readEscapeSequence(text: string, start: number): EscapeSequence | null {
  const second = text.charCodeAt(start + ESC_CODE_LENGTH)
  if (Number.isNaN(second)) return null
  if (second === CSI_MARKER_CODE) return readCsiSequence(text, start)
  if (second === OSC_MARKER_CODE) return readOscSequence(text, start)
  if (second === DCS_MARKER_CODE) return readDcsSequence(text, start)
  return readPlainEscapeSequence(text, start, second)
}

function readCsiSequence(text: string, start: number): EscapeSequence | null {
  for (let index = ESC_BODY_OFFSET + start; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= CSI_FINAL_MIN && code <= CSI_FINAL_MAX) {
      return {
        raw: text.slice(start, index + ESC_CODE_LENGTH),
        body: text.slice(start + ESC_BODY_OFFSET, index),
        kind: ESCAPE_KIND_CSI,
        end: index + ESC_CODE_LENGTH,
      }
    }
  }
  return null
}

function readOscSequence(text: string, start: number): EscapeSequence | null {
  for (let index = ESC_BODY_OFFSET + start; index < text.length; index += 1) {
    if (text.charCodeAt(index) === BEL_CODE) {
      return {
        raw: text.slice(start, index + ESC_CODE_LENGTH),
        body: text.slice(start + ESC_BODY_OFFSET, index),
        kind: ESCAPE_KIND_OSC,
        end: index + ESC_CODE_LENGTH,
      }
    }
    if (text.charCodeAt(index) === ESC_CODE && text.charCodeAt(index + 1) === ST_ESCAPE_CODE) {
      return {
        raw: text.slice(start, index + ST_LENGTH),
        body: text.slice(start + ESC_BODY_OFFSET, index),
        kind: ESCAPE_KIND_OSC,
        end: index + ST_LENGTH,
      }
    }
  }
  return null
}

function readDcsSequence(text: string, start: number): EscapeSequence | null {
  for (let index = ESC_BODY_OFFSET + start; index < text.length - ESC_CODE_LENGTH; index += 1) {
    if (text.charCodeAt(index) === ESC_CODE && text.charCodeAt(index + 1) === ST_ESCAPE_CODE) {
      return {
        raw: text.slice(start, index + ST_LENGTH),
        body: text.slice(start + ESC_BODY_OFFSET, index),
        kind: ESCAPE_KIND_DCS,
        end: index + ST_LENGTH,
      }
    }
  }
  return null
}

function readPlainEscapeSequence(
  text: string,
  start: number,
  second: number,
): EscapeSequence | null {
  if (second < ESC_INTERMEDIATE_MIN || second > ESC_INTERMEDIATE_MAX) {
    return {
      raw: text.slice(start, start + ESC_BODY_OFFSET),
      body: '',
      kind: ESCAPE_KIND_ESC,
      end: start + ESC_BODY_OFFSET,
    }
  }
  for (let index = start + ESC_BODY_OFFSET; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= ESC_FINAL_MIN && code <= ESC_FINAL_MAX) {
      return {
        raw: text.slice(start, index + ESC_CODE_LENGTH),
        body: text.slice(start + ESC_CODE_LENGTH, index),
        kind: ESCAPE_KIND_ESC,
        end: index + ESC_CODE_LENGTH,
      }
    }
  }
  return null
}

function isQuerySequence(body: string, kind: string, raw: string) {
  if (kind === ESCAPE_KIND_OSC) {
    return /^1[012];\?/.test(body)
  }

  if (kind === ESCAPE_KIND_DCS) {
    return /^\+\$?q/.test(body)
  }

  // DECRQM: intermediate `$` before final `p`.
  if (body.endsWith('$')) return true
  // kitty keyboard query `CSI ? u` and similar `CSI ? <final>` probes.
  if (body.endsWith('?')) return true
  // Two-byte ESC forms carry no final byte and are never queries.
  if (raw.length < ESC_BODY_OFFSET + ESC_CODE_LENGTH) return false
  const final = raw.slice(-1)
  if (body.startsWith('>')) {
    // Secondary DA (`>c`) and XTVERSION (`>q`).
    return final === 'c' || final === 'q'
  }
  return final === 'n' || final === 'c'
}

function isUnsafeReplaySequence(body: string, kind: string, raw: string) {
  if (isQuerySequence(body, kind, raw)) return true
  // Cold history is presentation, not a live terminal protocol stream. OSC,
  // DCS, and plain ESC commands can mutate title/clipboard/hyperlinks,
  // character sets, keypad mode, or other emulator state. None is required to
  // preserve the readable transcript, so retain them only for a live attach.
  if (kind === ESCAPE_KIND_OSC || kind === ESCAPE_KIND_DCS || kind === ESCAPE_KIND_ESC) {
    return true
  }
  if (kind !== ESCAPE_KIND_CSI) return true

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
