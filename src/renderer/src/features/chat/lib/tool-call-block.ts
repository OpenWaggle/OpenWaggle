import { isMatching, match, P } from '@diegogbrisa/ts-match'
import type { JsonObject } from '@shared/types/json'
import { normalizeToolResultPayload } from '@shared/utils/tool-result-state'
import { isRecord } from '@shared/utils/validation'
import { resolveLanguage } from '@/shared/lib/shiki/highlighter'

export const JSON_STRINGIFY_SPACES = 2
export const LONG_ARGUMENT_PREVIEW_CHARS = 120
export const LONG_ARGUMENT_MAX_HEIGHT_PX = 200
export const RESULT_MAX_HEIGHT_PX = 300
export const INLINE_DIFF_LINE_LIMIT = 32
export const OUTPUT_PREVIEW_LINES = 6
export const LINE_SPLIT_SEPARATOR = '\n'
export const HIGHLIGHT_MAX_CHARS = 80_000
export const HIGHLIGHT_MAX_LINES = 1_200
export const MIN_MARKDOWN_FENCE_LENGTH = 3
export const FILE_CONTENT_ARG_KEYS = new Set(['content', 'oldString', 'newString'])

export interface ToolCallResultPayload {
  readonly content: unknown
  readonly state: string
  readonly sourceMessageId?: string
  readonly error?: string
}

export interface UnifiedDiffLine {
  readonly type: 'add' | 'remove' | 'context' | 'meta'
  readonly content: string
}

export interface UnifiedDiffData {
  readonly text: string
  readonly lines: readonly UnifiedDiffLine[]
  readonly additions: number
  readonly deletions: number
}

function isTextContentBlock(
  value: unknown,
): value is { readonly type: 'text'; readonly text: string } {
  return isMatching({ type: 'text', text: P.string }, value)
}

function parseResultPayload(content: unknown) {
  return normalizeToolResultPayload(content)
}

function formatUnknownContent(content: unknown) {
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (content === null || content === undefined) return ''
  try {
    return JSON.stringify(content, null, JSON_STRINGIFY_SPACES)
  } catch {
    return String(content)
  }
}

function getToolResultDetails(content: unknown) {
  const parsed = parseResultPayload(content)
  return match(parsed)
    .with({ details: P.select() }, (details) => details)
    .otherwise(() => undefined)
}

function textFromContentBlocks(content: readonly unknown[]) {
  const textBlocks: string[] = []
  for (const block of content) {
    if (isTextContentBlock(block)) {
      textBlocks.push(block.text)
    }
  }
  return textBlocks.length > 0 ? textBlocks.join('\n') : null
}

function textFromResultRecord(parsed: { readonly [key: string]: unknown }) {
  const contentText = match(parsed)
    .with({ content: P.select('content', P.array(P._)) }, ({ content }) =>
      textFromContentBlocks(content),
    )
    .otherwise(() => null)

  if (contentText) {
    return contentText
  }

  const message = match(parsed.message)
    .with(P.string, (value) => value)
    .otherwise(() => null)
  if (message) {
    return message
  }

  return match(parsed.error)
    .with(P.string, (value) => value)
    .otherwise(() => null)
}

export function getToolResultText(content: unknown) {
  const parsed = parseResultPayload(content)
  return match(parsed)
    .with(P.string, (value) => value)
    .when(isRecord, (value) => textFromResultRecord(value) ?? formatUnknownContent(value))
    .otherwise((value) => formatUnknownContent(value))
}

export function getStringArg(args: JsonObject, key: string) {
  const value = args[key]
  return typeof value === 'string' ? value : null
}

export function inferLanguageFromPath(path: string | null) {
  if (!path) {
    return undefined
  }

  const extension = path.split('.').pop()
  if (!extension || extension === path) {
    return undefined
  }

  return resolveLanguage(extension.toLowerCase())
}

function exceedsLineLimit(text: string, maxLines: number) {
  if (!text) return false

  let lineCount = 1
  for (const char of text) {
    if (char !== LINE_SPLIT_SEPARATOR) {
      continue
    }
    lineCount += 1
    if (lineCount > maxLines) {
      return true
    }
  }
  return false
}

export function shouldHighlightCode(text: string) {
  return text.length <= HIGHLIGHT_MAX_CHARS && !exceedsLineLimit(text, HIGHLIGHT_MAX_LINES)
}

export function buildFencedCodeMarkdown(code: string, language: string | undefined) {
  const fenceLength = Math.max(
    MIN_MARKDOWN_FENCE_LENGTH,
    ...Array.from(code.matchAll(/`+/g)).map((match) => match[0].length + 1),
  )
  const fence = '`'.repeat(fenceLength)
  return `${fence}${language ?? ''}\n${code}\n${fence}`
}

export function getResultError(result: ToolCallResultPayload | undefined) {
  if (!result) return null
  if (result.error) return result.error
  if (result.state === 'error') {
    const text = getToolResultText(result.content).trim()
    return text || 'Tool execution failed.'
  }

  const parsed = parseResultPayload(result.content)
  if (isRecord(parsed) && typeof parsed.error === 'string') {
    return parsed.error
  }
  return null
}

function parseUnifiedDiff(diffText: string): UnifiedDiffData {
  let additions = 0
  let deletions = 0
  const lines = diffText.split(LINE_SPLIT_SEPARATOR).map((line): UnifiedDiffLine => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return { type: 'meta', content: line }
    }
    if (line.startsWith('+')) {
      additions += 1
      return { type: 'add', content: line }
    }
    if (line.startsWith('-')) {
      deletions += 1
      return { type: 'remove', content: line }
    }
    return { type: 'context', content: line }
  })

  return { text: diffText, lines, additions, deletions }
}

export function getUnifiedDiffLineClassName(type: UnifiedDiffLine['type']) {
  return match(type)
    .with('add', () => 'bg-success/10 text-success')
    .with('remove', () => 'bg-error/10 text-error')
    .with('meta', () => 'text-text-muted')
    .with('context', () => 'text-text-secondary')
    .exhaustive()
}

export function getEditUnifiedDiff(content: unknown, name: string): UnifiedDiffData | null {
  if (name !== 'edit') {
    return null
  }

  const details = getToolResultDetails(content)
  const diff = match(details)
    .with({ diff: P.select('diff', P.string) }, ({ diff }) => diff)
    .otherwise(() => null)
  if (diff?.trim()) {
    return parseUnifiedDiff(diff)
  }

  const parsed = parseResultPayload(content)
  if (
    isRecord(parsed) &&
    typeof parsed.beforeContent === 'string' &&
    typeof parsed.afterContent === 'string' &&
    parsed.beforeContent !== parsed.afterContent
  ) {
    return null
  }

  return null
}

export function buildTailPreview(text: string) {
  const lines = text.trim().split(LINE_SPLIT_SEPARATOR)
  return lines.slice(-OUTPUT_PREVIEW_LINES).join('\n')
}
