import { TERMINAL } from '@shared/constants/resource-limits'

const UTF8_ONE_BYTE_MAX = 0x7f
const UTF8_TWO_BYTE_MAX = 0x7ff
const UTF8_THREE_BYTE_MAX = 0xffff
const UTF8_ONE_BYTE_WIDTH = 1
const UTF8_TWO_BYTE_WIDTH = 2
const UTF8_THREE_BYTE_WIDTH = 3
const UTF8_MAX_CODE_POINT_WIDTH = 4

/** UTF-8 width of one JavaScript code point, including unpaired surrogates. */
function utf8Width(character: string) {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return 0
  if (codePoint <= UTF8_ONE_BYTE_MAX) return UTF8_ONE_BYTE_WIDTH
  if (codePoint <= UTF8_TWO_BYTE_MAX) return UTF8_TWO_BYTE_WIDTH
  if (codePoint <= UTF8_THREE_BYTE_MAX) return UTF8_THREE_BYTE_WIDTH
  return UTF8_MAX_CODE_POINT_WIDTH
}

/**
 * Split terminal input at Unicode code-point boundaries so every IPC write is
 * within the main-process UTF-8 byte limit. Concatenating the chunks always
 * reproduces the original input exactly.
 */
export function chunkTerminalInput(
  input: string,
  maxBytes: number = TERMINAL.MAX_INPUT_BYTES,
): readonly string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < UTF8_MAX_CODE_POINT_WIDTH) {
    throw new RangeError('Terminal input chunks must allow one UTF-8 code point.')
  }
  if (input.length === 0) return []

  const chunks: string[] = []
  let chunkStart = 0
  let chunkBytes = 0
  let cursor = 0

  for (const character of input) {
    const characterBytes = utf8Width(character)
    if (chunkBytes > 0 && chunkBytes + characterBytes > maxBytes) {
      chunks.push(input.slice(chunkStart, cursor))
      chunkStart = cursor
      chunkBytes = 0
    }
    chunkBytes += characterBytes
    cursor += character.length
  }

  if (chunkStart < input.length) chunks.push(input.slice(chunkStart))
  return chunks
}

/** Slice a terminal string at a UTF-8 stream offset without splitting a code point. */
export function sliceTerminalDataAfterBytes(data: string, skippedBytes: number): string {
  if (skippedBytes <= 0) return data
  let consumedBytes = 0
  let cursor = 0
  for (const character of data) {
    const nextBytes = consumedBytes + utf8Width(character)
    if (nextBytes > skippedBytes) break
    consumedBytes = nextBytes
    cursor += character.length
  }
  return data.slice(cursor)
}
