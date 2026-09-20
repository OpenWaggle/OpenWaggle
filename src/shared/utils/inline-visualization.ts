import {
  INLINE_VISUALIZATION_PROTOCOL,
  MAX_INLINE_VISUALIZATION_PATH_LENGTH,
} from '../constants/inline-visualization'
import type { InlineVisualizationReference } from '../types/inline-visualization'
import { isRecord } from './validation'

export const VISUALIZE_REFERENCE_START = '\uE200visualize\uE202'
export const VISUALIZE_REFERENCE_END = '\uE201'
// The delimiter-free form the visible skill template teaches: the bare reference
// must open a line (only whitespace before it) and fill that line, so ordinary
// prose mentioning it never mounts a frame.
const BARE_REFERENCE_PREFIX = 'visualize{'
const BARE_REFERENCE_PATTERN = /^visualize(\{.*\})$/
const VISUALIZE_REFERENCE_KEYS = new Set(['path', 'title', 'mode'])
const MAX_VISUALIZATION_TITLE_LENGTH = 250

export function isAbsoluteVisualizationPath(value: string) {
  return (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/.test(value) ||
    /^\/\/[^/]+\/[^/]+/.test(value)
  )
}

function isValidVisualizationPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_INLINE_VISUALIZATION_PATH_LENGTH &&
    !value.includes('\0') &&
    isAbsoluteVisualizationPath(value)
  )
}

function isValidVisualizationTitle(value: unknown) {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= MAX_VISUALIZATION_TITLE_LENGTH)
  )
}

export function parseInlineVisualizationReference(
  value: string,
): InlineVisualizationReference | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null
    if (Object.keys(parsed).some((key) => !VISUALIZE_REFERENCE_KEYS.has(key))) return null
    if (!isValidVisualizationPath(parsed.path)) return null
    if (!isValidVisualizationTitle(parsed.title)) return null
    if (parsed.mode !== undefined && parsed.mode !== 'wide') return null

    return {
      path: parsed.path,
      ...(typeof parsed.title === 'string' ? { title: parsed.title } : {}),
      ...(parsed.mode === 'wide' ? { mode: 'wide' as const } : {}),
    }
  } catch {
    return null
  }
}

export interface InlineVisualizationReferenceMatch {
  readonly start: number
  readonly end: number
  readonly reference: InlineVisualizationReference
}

export type NextVisualizationReferenceMatch =
  | ({ readonly kind: 'complete' } & InlineVisualizationReferenceMatch)
  | { readonly kind: 'unterminated'; readonly start: number }

function findNextDelimitedReferenceMatch(
  text: string,
  from: number,
): NextVisualizationReferenceMatch | null {
  let offset = from
  while (offset < text.length) {
    const start = text.indexOf(VISUALIZE_REFERENCE_START, offset)
    if (start === -1) return null
    const payloadStart = start + VISUALIZE_REFERENCE_START.length
    const end = text.indexOf(VISUALIZE_REFERENCE_END, payloadStart)
    if (end === -1) return { kind: 'unterminated', start }
    const reference = parseInlineVisualizationReference(text.slice(payloadStart, end))
    if (reference) {
      return { kind: 'complete', start, end: end + VISUALIZE_REFERENCE_END.length, reference }
    }
    offset = end + VISUALIZE_REFERENCE_END.length
  }
  return null
}

function findNextBareReferenceMatch(
  text: string,
  from: number,
): InlineVisualizationReferenceMatch | null {
  let searchFrom = from
  while (searchFrom < text.length) {
    const candidate = text.indexOf(BARE_REFERENCE_PREFIX, searchFrom)
    if (candidate === -1) return null
    let lineStart = candidate
    while (lineStart > 0 && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
      lineStart -= 1
    }
    if (lineStart === 0 || text[lineStart - 1] === '\n') {
      const lineEnd = text.indexOf('\n', candidate)
      const end = lineEnd === -1 ? text.length : lineEnd
      const payload = BARE_REFERENCE_PATTERN.exec(text.slice(lineStart, end).trim())?.[1]
      const reference = payload ? parseInlineVisualizationReference(payload) : null
      if (reference) return { start: lineStart, end, reference }
    }
    searchFrom = candidate + 1
  }
  return null
}

export function findNextVisualizationReferenceMatch(
  text: string,
  from: number,
): NextVisualizationReferenceMatch | null {
  const delimited = findNextDelimitedReferenceMatch(text, from)
  const bare = findNextBareReferenceMatch(text, from)
  if (!delimited) return bare ? { kind: 'complete', ...bare } : null
  if (delimited.kind === 'unterminated') {
    return !bare || bare.start >= delimited.start ? delimited : { kind: 'complete', ...bare }
  }
  if (!bare) return delimited
  return bare.start < delimited.start ? { kind: 'complete', ...bare } : delimited
}

export function containsInlineVisualizationReference(text: string) {
  if (text.includes(VISUALIZE_REFERENCE_START)) return true
  const textParts = readContentTextParts(text)
  if (textParts) return textParts.some((part) => findNextBareReferenceMatch(part, 0) !== null)
  return findNextBareReferenceMatch(text, 0) !== null
}

/**
 * Ownership checks run over serialized content JSON ({parts:[...]}); the bare form's
 * own-line rule must apply to the decoded message text, not the escaped serialization.
 */
function readContentTextParts(text: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !Array.isArray(parsed.parts)) return null
    const parts: string[] = []
    for (const part of parsed.parts) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text)
      }
    }
    return parts
  } catch {
    return null
  }
}

/** Withholds a trailing, not-yet-parseable reference while streaming so partial markers or JSON never flash. */
export function withholdUnresolvedVisualizationSuffix(text: string) {
  const maximumSuffixLength = Math.min(text.length, VISUALIZE_REFERENCE_START.length - 1)
  for (let length = maximumSuffixLength; length > 0; length -= 1) {
    if (text.endsWith(VISUALIZE_REFERENCE_START.slice(0, length))) {
      return text.slice(0, -length)
    }
  }
  const lastLineStart = text.lastIndexOf('\n') + 1
  const trailingLine = text.slice(lastLineStart)
  if (trailingLine.trimStart().startsWith(BARE_REFERENCE_PREFIX)) {
    if (!findNextBareReferenceMatch(trailingLine, 0)) return text.slice(0, lastLineStart)
  }
  return text
}

export function extractInlineVisualizationReferences(text: string) {
  const references: InlineVisualizationReference[] = []
  let offset = 0
  while (offset < text.length) {
    const match = findNextVisualizationReferenceMatch(text, offset)
    if (!match) break
    if (match.kind === 'unterminated') {
      // A stray delimited start without an end must not hide later bare references.
      offset = match.start + VISUALIZE_REFERENCE_START.length
      continue
    }
    references.push(match.reference)
    offset = match.end
  }
  return references
}

export function inlineVisualizationFrameUrl(frameId: string) {
  return new URL(
    `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}://${INLINE_VISUALIZATION_PROTOCOL.FRAME_HOST_PREFIX}${frameId}${INLINE_VISUALIZATION_PROTOCOL.DOCUMENT_PATH}`,
  ).toString()
}
