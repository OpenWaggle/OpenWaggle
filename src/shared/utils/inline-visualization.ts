import { INLINE_VISUALIZATION_PROTOCOL } from '../constants/inline-visualization'
import type { InlineVisualizationReference } from '../types/inline-visualization'
import { isRecord } from './validation'

export const VISUALIZE_REFERENCE_START = 'visualize'
export const VISUALIZE_REFERENCE_END = ''
const VISUALIZE_REFERENCE_KEYS = new Set(['path', 'title', 'mode'])
const MAX_VISUALIZATION_PATH_LENGTH = 32_768
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
    value.length <= MAX_VISUALIZATION_PATH_LENGTH &&
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

export function extractInlineVisualizationReferences(text: string) {
  const references: InlineVisualizationReference[] = []
  let offset = 0
  while (offset < text.length) {
    const start = text.indexOf(VISUALIZE_REFERENCE_START, offset)
    if (start === -1) break
    const payloadStart = start + VISUALIZE_REFERENCE_START.length
    const end = text.indexOf(VISUALIZE_REFERENCE_END, payloadStart)
    if (end === -1) break
    const reference = parseInlineVisualizationReference(text.slice(payloadStart, end))
    if (reference) references.push(reference)
    offset = end + VISUALIZE_REFERENCE_END.length
  }
  return references
}

export function inlineVisualizationFrameUrl(frameId: string) {
  return new URL(
    `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}://${INLINE_VISUALIZATION_PROTOCOL.FRAME_HOST_PREFIX}${frameId}${INLINE_VISUALIZATION_PROTOCOL.DOCUMENT_PATH}`,
  ).toString()
}
