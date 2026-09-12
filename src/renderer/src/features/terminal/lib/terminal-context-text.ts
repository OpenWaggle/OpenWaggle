export interface TextMetrics {
  readonly characters: number
  readonly bytes: number
}

export interface LimitedText extends TextMetrics {
  readonly text: string
  readonly truncated: boolean
}

const XML_REPLACEMENT_CHARACTER = '\uFFFD'
const ASCII_MAX_CODE_POINT = 0x7f
const UTF8_TWO_BYTE_MAX_CODE_POINT = 0x7ff
const BASIC_MULTILINGUAL_PLANE_MAX_CODE_POINT = 0xffff
const UTF8_TWO_BYTE_WIDTH = 2
const UTF8_THREE_BYTE_WIDTH = 3
const UTF8_FOUR_BYTE_WIDTH = 4
const XML_TAB_CODE_POINT = 0x09
const XML_LINE_FEED_CODE_POINT = 0x0a
const XML_CARRIAGE_RETURN_CODE_POINT = 0x0d
const XML_LOW_RANGE_START = 0x20
const XML_LOW_RANGE_END = 0xd7ff
const XML_HIGH_RANGE_START = 0xe000
const XML_HIGH_RANGE_END = 0xfffd
const XML_ASTRAL_RANGE_START = 0x10000
const XML_ASTRAL_RANGE_END = 0x10ffff

function utf8Width(character: string) {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return 0
  if (codePoint <= ASCII_MAX_CODE_POINT) return 1
  if (codePoint <= UTF8_TWO_BYTE_MAX_CODE_POINT) return UTF8_TWO_BYTE_WIDTH
  if (codePoint <= BASIC_MULTILINGUAL_PLANE_MAX_CODE_POINT) return UTF8_THREE_BYTE_WIDTH
  return UTF8_FOUR_BYTE_WIDTH
}

export function textMetrics(text: string): TextMetrics {
  let characters = 0
  let bytes = 0
  for (const character of text) {
    characters += 1
    bytes += utf8Width(character)
  }
  return { characters, bytes }
}

export function limitText(text: string, maxCharacters: number, maxBytes: number): LimitedText {
  let characters = 0
  let bytes = 0
  let endIndex = 0
  for (const character of text) {
    const nextBytes = bytes + utf8Width(character)
    if (characters + 1 > maxCharacters || nextBytes > maxBytes) break
    characters += 1
    bytes = nextBytes
    endIndex += character.length
  }
  return {
    text: text.slice(0, endIndex),
    characters,
    bytes,
    truncated: endIndex < text.length,
  }
}

function validXmlCodePoint(codePoint: number) {
  return (
    codePoint === XML_TAB_CODE_POINT ||
    codePoint === XML_LINE_FEED_CODE_POINT ||
    codePoint === XML_CARRIAGE_RETURN_CODE_POINT ||
    (codePoint >= XML_LOW_RANGE_START && codePoint <= XML_LOW_RANGE_END) ||
    (codePoint >= XML_HIGH_RANGE_START && codePoint <= XML_HIGH_RANGE_END) ||
    (codePoint >= XML_ASTRAL_RANGE_START && codePoint <= XML_ASTRAL_RANGE_END)
  )
}

export function sanitizeXmlCharacters(text: string) {
  let sanitized = ''
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    sanitized +=
      codePoint !== undefined && validXmlCodePoint(codePoint)
        ? character
        : XML_REPLACEMENT_CHARACTER
  }
  return sanitized
}

export function escapeXml(text: string) {
  return sanitizeXmlCharacters(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function normalizeSelectedText(text: string) {
  return sanitizeXmlCharacters(text.replace(/\r\n?/gu, '\n')).replace(/^\n+|\n+$/gu, '')
}

export function normalizeMetadata(text: string) {
  return sanitizeXmlCharacters(text.replace(/\r\n?/gu, '\n')).trim()
}

export function normalizeSingleLineMetadata(text: string) {
  return normalizeMetadata(text).replace(/\s+/gu, ' ')
}
