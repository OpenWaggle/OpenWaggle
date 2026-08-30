export const MAX_SYNTAX_SOURCE_CODE_UNITS = 1024 * 1024
export const MAX_SYNTAX_LINE_COUNT = 50_000
export const MAX_SYNTAX_LINE_CODE_UNITS = 50_000
export const MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS = 64 * 1024
export const MAX_COMPACT_SYNTAX_LINE_COUNT = 1_000
const LINE_FEED_CODE_POINT = 10
const FNV_OFFSET_BASIS = 2_166_136_261
const FNV_PRIME = 16_777_619
const HASH_RADIX = 36

export interface SyntaxAdmissionResult {
  readonly admitted: boolean
  readonly diagnostic?: string
}

export function syntaxHighlightAdmission(source: string): SyntaxAdmissionResult {
  if (source.length > MAX_SYNTAX_SOURCE_CODE_UNITS) {
    return {
      admitted: false,
      diagnostic:
        'Syntax highlighting was skipped because this source exceeds the 1 MiB rendering budget.',
    }
  }

  let lineCount = 1
  let currentLineLength = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === LINE_FEED_CODE_POINT) {
      lineCount += 1
      currentLineLength = 0
      if (lineCount > MAX_SYNTAX_LINE_COUNT) {
        return {
          admitted: false,
          diagnostic:
            'Syntax highlighting was skipped because this source exceeds the 50,000-line rendering budget.',
        }
      }
      continue
    }
    currentLineLength += 1
    if (currentLineLength > MAX_SYNTAX_LINE_CODE_UNITS) {
      return {
        admitted: false,
        diagnostic:
          'Syntax highlighting was skipped because this source contains a line longer than 50,000 characters.',
      }
    }
  }

  return { admitted: true }
}

export function sourceViewLines(source: string) {
  return source.split('\n')
}

export function shouldVirtualizeSyntaxSource(source: string) {
  if (source.length > MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS) return true
  let lineCount = 1
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) !== LINE_FEED_CODE_POINT) continue
    lineCount += 1
    if (lineCount > MAX_COMPACT_SYNTAX_LINE_COUNT) return true
  }
  return false
}

export function syntaxSourceFingerprint(source: string) {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(HASH_RADIX)
}
