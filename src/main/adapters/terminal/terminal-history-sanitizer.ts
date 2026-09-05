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
const ST = `${ESC}\\`

export interface TerminalHistorySanitizer {
  /** Sanitize one output chunk; carries incomplete sequence tails internally. */
  feed(chunk: string): string
}

/** One-shot scrub for text known to contain no split sequences (tests, replay reads). */
export function stripTerminalQuerySequences(text: string) {
  return stripQuerySequences(text, -1)
}

export function createTerminalHistorySanitizer() {
  let tail = ''

  const feed = (chunk: string) => {
    const text = tail + chunk
    tail = ''
    const parts = splitAtIncompleteTail(text)
    const sanitized = stripQuerySequences(parts.complete, parts.incompleteStart)
    if (parts.incomplete.length > 0 && parts.incomplete.length <= MAX_PENDING_TAIL) {
      tail = parts.incomplete
    }
    return sanitized
  }

  return { feed }
}

function splitAtIncompleteTail(text: string) {
  const lastEsc = text.lastIndexOf(ESC)
  if (lastEsc === -1) {
    return { complete: text, incomplete: '', incompleteStart: -1 }
  }

  const tail = text.slice(lastEsc)
  if (isCompleteEscapeSequence(tail)) {
    return { complete: text, incomplete: '', incompleteStart: -1 }
  }

  return { complete: text.slice(0, lastEsc), incomplete: tail, incompleteStart: lastEsc }
}

function isCompleteEscapeSequence(sequence: string) {
  if (sequence.length < ESC_BODY_OFFSET) return false
  const second = sequence.charCodeAt(ESC_CODE_LENGTH)

  // OSC: complete at BEL or ST (ESC \).
  if (second === OSC_MARKER_CODE) {
    if (sequence.includes(String.fromCharCode(BEL_CODE))) return true
    return sequence.slice(ESC_BODY_OFFSET).includes(ST)
  }

  // DCS: complete at ST.
  if (second === DCS_MARKER_CODE) {
    return sequence.slice(ESC_BODY_OFFSET).includes(ST)
  }

  // CSI: complete once a final byte in 0x40–0x7e appears.
  if (second === CSI_MARKER_CODE) {
    for (let index = ESC_BODY_OFFSET; index < sequence.length; index += 1) {
      const code = sequence.charCodeAt(index)
      if (code >= CSI_FINAL_MIN && code <= CSI_FINAL_MAX) return true
    }
    return false
  }

  // Two-byte ESC sequences are complete immediately.
  return true
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
function stripQuerySequences(text: string, incompleteStart = -1) {
  let output = ''
  let cursor = 0

  while (cursor < text.length) {
    const escIndex = text.indexOf(ESC, cursor)
    if (escIndex === -1) {
      output += text.slice(cursor)
      break
    }

    // Anything from an incomplete sequence's ESC onward is held for the next
    // chunk instead of leaking a half-parsed query into the output.
    if (incompleteStart !== -1 && escIndex >= incompleteStart) break

    output += text.slice(cursor, escIndex)
    const sequence = readEscapeSequence(text, escIndex)
    if (sequence === null) {
      // Not a recognized sequence shape; keep the ESC byte and move on.
      output += ESC
      cursor = escIndex + ESC_CODE_LENGTH
      continue
    }

    if (!isQuerySequence(sequence.body, sequence.kind, sequence.raw)) {
      output += sequence.raw
    }
    cursor = sequence.end
  }

  return output
}

const ESCAPE_KIND_CSI = 'csi'
const ESCAPE_KIND_OSC = 'osc'
const ESCAPE_KIND_DCS = 'dcs'

function readEscapeSequence(text: string, start: number) {
  const second = text.charCodeAt(start + ESC_CODE_LENGTH)
  if (Number.isNaN(second)) return null

  if (second === CSI_MARKER_CODE) {
    // CSI: params/intermediates until a final byte 0x40–0x7e.
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

  if (second === OSC_MARKER_CODE) {
    // OSC: terminated by BEL or ST.
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

  if (second === DCS_MARKER_CODE) {
    // DCS: terminated by ST.
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

  // Other ESC sequences (two-byte and SS forms) are preserved as-is.
  return {
    raw: text.slice(start, start + ESC_BODY_OFFSET),
    body: '',
    kind: ESCAPE_KIND_CSI,
    end: start + ESC_BODY_OFFSET,
  }
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
