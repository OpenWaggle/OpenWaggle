/**
 * Pure terminal escape-sequence scanning shared by main-process history
 * hygiene and the renderer's replay path (ADR 0030, issue #385).
 *
 * Programs send queries (DSR/CPR, DA, DECRQM, XTVERSION, DECRQSS, kitty
 * keyboard, OSC palette and colour queries) expecting the live terminal to
 * answer. A query replayed from history into a fresh emulator is answered
 * again, and the answer reaches whatever now reads the PTY: usually a shell
 * prompt, which receives it as typed input. Stripping queries from replayed
 * history removes that whole class of bug while keeping everything that
 * renders.
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
const ESC_BODY_OFFSET = 2
const ESC_CODE_LENGTH = 1
const ST_LENGTH = 2

const ESC = String.fromCharCode(ESC_CODE)

export const ESCAPE_KIND_CSI = 'csi'
export const ESCAPE_KIND_OSC = 'osc'
export const ESCAPE_KIND_DCS = 'dcs'
export const ESCAPE_KIND_ESC = 'esc'

export type EscapeSequenceKind =
  | typeof ESCAPE_KIND_CSI
  | typeof ESCAPE_KIND_OSC
  | typeof ESCAPE_KIND_DCS
  | typeof ESCAPE_KIND_ESC

interface EscapeSequence {
  readonly raw: string
  readonly body: string
  readonly kind: EscapeSequenceKind
  readonly end: number
}

export type EscapeSequencePredicate = (
  body: string,
  kind: EscapeSequenceKind,
  raw: string,
) => boolean

/**
 * OSC commands that answer when a colour (or clipboard) field is `?`:
 * OSC 4 / 5 (palette and special colours, `4;<index>;?`), OSC 10-19 (dynamic
 * colours: foreground, background, cursor, pointer, Tektronix, highlight; one
 * `?` per chained colour), and OSC 52 (clipboard read, `52;<selection>;?`).
 */
const OSC_QUERY_COMMANDS = new Set([
  '4',
  '5',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '52',
])

/** XTWINOPS reports (`CSI 14 t`, `CSI 18 t`, title reports, ...); the rest change state. */
const WINDOW_REPORT_PARAMETER = /^(?:1[1345689]|2[01])(?:;|$)/

/** Splits text before an escape sequence that is still incomplete at its end. */
export function splitAtIncompleteTail(text: string) {
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

/** Removes every complete escape sequence the predicate selects; other bytes are kept. */
export function stripEscapeSequences(text: string, shouldStrip: EscapeSequencePredicate) {
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

/**
 * Whether a complete escape sequence asks the terminal to answer:
 *
 * - CSI `n` (DSR, CPR, `?996n` colour scheme) and `c` (primary, secondary, tertiary DA)
 * - CSI DECRQM (`$p`, intermediate `$` before final `p`), kitty keyboard `CSI ? u`
 * - CSI `> q` (XTVERSION) and XTWINOPS reports (`CSI 14 t`, `CSI 18 t`, ...)
 * - DCS `$ q` (DECRQSS) and `+ q` (XTGETTCAP)
 * - OSC 4/5/10-19/52 with a `?` field (palette, dynamic colour, clipboard queries)
 * - ESC `Z` (DECID)
 */
export function isTerminalQuerySequence(body: string, kind: EscapeSequenceKind, raw: string) {
  if (kind === ESCAPE_KIND_OSC) return isOscQuery(body)
  if (kind === ESCAPE_KIND_DCS) return /^[0-9;]*[+$]q/.test(body)
  if (kind === ESCAPE_KIND_ESC) return raw === `${ESC}Z`
  return isCsiQuery(body, raw.slice(-1))
}

/** One-shot scrub for text known to contain no split sequences; an incomplete tail is kept. */
export function stripTerminalQuerySequences(text: string) {
  const parts = splitAtIncompleteTail(text)
  return stripEscapeSequences(parts.complete, isTerminalQuerySequence) + parts.incomplete
}

function isOscQuery(body: string) {
  const [command, ...fields] = body.split(';')
  return command !== undefined && OSC_QUERY_COMMANDS.has(command) && fields.includes('?')
}

function isCsiQuery(body: string, final: string) {
  // DECRQM: intermediate `$` before final `p` (DECRPM answers end `$y` and are inert too).
  if (body.endsWith('$')) return true
  // kitty keyboard query `CSI ? u` and similar `CSI ? <final>` probes.
  if (body.endsWith('?')) return true
  if (body.startsWith('>')) {
    // Secondary DA (`>c`) and XTVERSION (`>q`).
    return final === 'c' || final === 'q'
  }
  if (final === 't') return WINDOW_REPORT_PARAMETER.test(body)
  return final === 'n' || final === 'c'
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
