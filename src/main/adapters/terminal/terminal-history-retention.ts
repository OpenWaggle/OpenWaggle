const CHAR_CODE_LINE_FEED = 10
const CHAR_CODE_HIGH_SURROGATE_MIN = 0xd800
const CHAR_CODE_HIGH_SURROGATE_MAX = 0xdbff
const CHAR_CODE_LOW_SURROGATE_MIN = 0xdc00
const CHAR_CODE_LOW_SURROGATE_MAX = 0xdfff
const UTF8_ONE_BYTE_MAX = 0x7f
const UTF8_TWO_BYTE_MAX = 0x7ff
const UTF8_THREE_BYTE_MAX = 0xffff
const UTF8_ONE_BYTE = 1
const UTF8_TWO_BYTES = 2
const UTF8_THREE_BYTES = 3
const UTF8_FOUR_BYTES = 4

export interface TerminalHistoryText {
  readonly text: string
  readonly bytes: number
  readonly lines: number
}

export type TerminalHistoryCounts = Omit<TerminalHistoryText, 'text'>

export function measureTerminalHistoryText(text: string): TerminalHistoryText {
  let lines = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === CHAR_CODE_LINE_FEED) lines += 1
  }
  return { text, bytes: Buffer.byteLength(text, 'utf8'), lines }
}

/** Keep the largest valid UTF-8 suffix within both terminal history caps. */
export function retainTerminalHistorySuffix(
  text: string,
  maxLines: number,
  maxBytes: number,
): TerminalHistoryText {
  let start = text.length
  let bytes = 0
  let lines = 0

  while (start > 0) {
    const nextStart = previousCodePointStart(text, start)
    const codePoint = text.codePointAt(nextStart)
    if (codePoint === undefined) break
    const codePointBytes = utf8CodePointBytes(codePoint)
    const nextLines = lines + (codePoint === CHAR_CODE_LINE_FEED ? 1 : 0)
    if (bytes + codePointBytes > maxBytes || nextLines > maxLines) break
    bytes += codePointBytes
    lines = nextLines
    start = nextStart
  }

  return { text: text.slice(start), bytes, lines }
}

function previousCodePointStart(text: string, end: number) {
  const lastIndex = end - 1
  const lastCode = text.charCodeAt(lastIndex)
  if (
    lastCode >= CHAR_CODE_LOW_SURROGATE_MIN &&
    lastCode <= CHAR_CODE_LOW_SURROGATE_MAX &&
    lastIndex > 0
  ) {
    const previousCode = text.charCodeAt(lastIndex - 1)
    if (
      previousCode >= CHAR_CODE_HIGH_SURROGATE_MIN &&
      previousCode <= CHAR_CODE_HIGH_SURROGATE_MAX
    ) {
      return lastIndex - 1
    }
  }
  return lastIndex
}

function utf8CodePointBytes(codePoint: number) {
  if (codePoint <= UTF8_ONE_BYTE_MAX) return UTF8_ONE_BYTE
  if (codePoint <= UTF8_TWO_BYTE_MAX) return UTF8_TWO_BYTES
  if (codePoint <= UTF8_THREE_BYTE_MAX) return UTF8_THREE_BYTES
  return UTF8_FOUR_BYTES
}
