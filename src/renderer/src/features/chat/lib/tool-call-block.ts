import { isMatching, match, P } from '@diegogbrisa/ts-match'
import type { JsonObject } from '@shared/types/json'
import { normalizeToolResultPayload } from '@shared/utils/tool-result-state'
import { isRecord } from '@shared/utils/validation'
import { languageFromPath } from '@/shared/lib/syntax/language-registry'

export const JSON_STRINGIFY_SPACES = 2
export const LONG_ARGUMENT_PREVIEW_CHARS = 120
export const LONG_ARGUMENT_MAX_HEIGHT_PX = 200
export const RESULT_MAX_HEIGHT_PX = 300
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

/** What an edit changed, read from Pi's edit tool result details (ADR 0050). */
export interface EditDiffData {
  /** Standard unified patch (`details.patch`); null for edits recorded before Pi sent one. */
  readonly patch: string | null
  /** The patch, or Pi's line-numbered display diff (`details.diff`) when there is no patch. */
  readonly text: string
  readonly additions: number
  readonly deletions: number
  /** 1-based line of the first change in the edited file, when known. */
  readonly firstChangedLine: number | null
}

const UNIFIED_HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u
const ANY_UNIFIED_HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/mu

function isTextContentBlock(
  value: unknown,
): value is { readonly type: 'text'; readonly text: string } {
  return isMatching({ type: 'text', text: P.string }, value)
}

function parseResultPayload(content: unknown) {
  return normalizeToolResultPayload(content)
}

function formatUnknownContent(content: unknown, serialized?: string | null) {
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (content === null || content === undefined) return ''
  try {
    return serialized ?? JSON.stringify(content, null, JSON_STRINGIFY_SPACES)
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

  const error = match(parsed.error)
    .with(P.string, (value) => value)
    .otherwise(() => null)
  if (error) {
    return error
  }

  return Array.isArray(parsed.content) && parsed.content.length === 0 ? '' : null
}

export function getToolResultText(content: unknown, serialized?: string | null) {
  const parsed = parseResultPayload(content)
  return match(parsed)
    .with(P.string, (value) => value)
    .when(
      isRecord,
      (value) => textFromResultRecord(value) ?? formatUnknownContent(value, serialized),
    )
    .otherwise((value) => formatUnknownContent(value, serialized))
}

export function getStringArg(args: JsonObject, key: string) {
  const value = args[key]
  return typeof value === 'string' ? value : null
}

export function inferLanguageFromPath(path: string | null) {
  if (!path) return undefined
  const language = languageFromPath(path)
  return language === 'text' ? undefined : language
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

/**
 * Counts changed lines. In a unified patch the `---`/`+++` file headers precede the
 * first hunk, so only lines after a hunk header count; Pi's display diff has no
 * headers and every changed line starts with its sign.
 */
function countChangedLines(text: string, isPatch: boolean) {
  let additions = 0
  let deletions = 0
  let inHunk = !isPatch
  for (const line of text.split(LINE_SPLIT_SEPARATOR)) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    // Text that is not a patch may still carry `---`/`+++` file headers; Pi's display
    // diff never does, because every changed line there starts with its sign and a
    // line number.
    if (!isPatch && (line.startsWith('--- ') || line.startsWith('+++ '))) continue
    if (line.startsWith('+')) additions += 1
    if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

/** New-file line of the first added or removed line in a unified patch. */
function firstChangedLineInPatch(patch: string) {
  let line: number | null = null
  for (const text of patch.split(LINE_SPLIT_SEPARATOR)) {
    const hunkStart = UNIFIED_HUNK_HEADER.exec(text)?.[1]
    if (hunkStart !== undefined) {
      line = Number(hunkStart)
      continue
    }
    if (line === null) continue
    if (text.startsWith('+') || text.startsWith('-')) return Math.max(1, line)
    // Some generators strip the space from an empty context line.
    if (text.startsWith(' ') || text === '') line += 1
  }
  return null
}

/**
 * Pi's unified patch, when it is one Pierre can render: anything without a hunk header
 * (an extension overriding `edit`, a corrupt Session) falls back to text, because
 * Pierre throws while rendering a patch it cannot parse.
 */
function renderablePatch(value: unknown) {
  const patch = nonEmptyString(value)
  if (patch === null) return null
  return ANY_UNIFIED_HUNK_HEADER.test(patch) ? patch : null
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function positiveLine(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

export function getEditDiff(content: unknown, name: string): EditDiffData | null {
  if (name !== 'edit') {
    return null
  }

  const details = getToolResultDetails(content)
  if (!isRecord(details)) {
    return null
  }
  const patch = renderablePatch(details.patch)
  const text = patch ?? nonEmptyString(details.diff) ?? nonEmptyString(details.patch)
  if (text === null) {
    return null
  }

  return {
    patch,
    text,
    ...countChangedLines(text, patch !== null),
    firstChangedLine:
      positiveLine(details.firstChangedLine) ?? (patch ? firstChangedLineInPatch(patch) : null),
  }
}

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/gu
/** Pi's sentence as a whole line of its own, for any path. */
const PI_EDIT_RESULT_WHOLE_LINE = /^Successfully replaced \d+ block\(s\) in .+\.(?:\r?\n|$)/mu
const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)+/u

/** Pi's own edit result line opening a block, for the edited path. */
function piEditResultPrefix(path: string | null) {
  const target = path === null ? '.+?' : path.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&')
  return new RegExp(
    `^Successfully replaced \\d+ block\\(s\\) in ${target}\\.(?=\\s|$)[ \\t]*(?:\\r?\\n)?`,
    'u',
  )
}

/**
 * Removes Pi's own line, which the diff already says, once: where Pi puts it (opening
 * the first block, possibly followed by text an extension appended on the same line),
 * or else as a line of its own anywhere, which also covers an extension that put its
 * block first or rewrote the path Pi reports.
 */
function withoutPiEditResultLine(blocks: readonly string[], path: string | null) {
  const [first = '', ...rest] = blocks
  const prefix = piEditResultPrefix(path)
  const opening = first.replace(LEADING_BLANK_LINES, '')
  if (prefix.test(opening)) return [opening.replace(prefix, ''), ...rest]
  let removed = false
  return blocks.map((text) => {
    if (removed || !PI_EDIT_RESULT_WHOLE_LINE.test(text)) return text
    removed = true
    return text.replace(PI_EDIT_RESULT_WHOLE_LINE, '')
  })
}

/**
 * Text in an edit result that its diff does not already convey, such as diagnostics an
 * extension added through Pi's `tool_result` hook: the text blocks without Pi's own
 * line. Indentation is kept, because diagnostics are often aligned code frames. Non-text
 * blocks and structured payloads are not output a reader needs next to the diff, so
 * this never falls back to serializing them.
 */
export function getEditExtraOutput(content: unknown, path: string | null): string {
  const parsed = parseResultPayload(content)
  const blocks = match(parsed)
    .with(P.string, (text) => [text])
    .with({ content: P.select('content', P.array(P._)) }, ({ content }) =>
      content.filter(isTextContentBlock).map((block) => block.text),
    )
    .otherwise(() => [])
  return withoutPiEditResultLine(blocks, path)
    .map((text) => text.replace(LEADING_BLANK_LINES, '').trimEnd())
    .filter((text) => text.trim() !== '')
    .join('\n')
}

export function buildTailPreview(text: string) {
  const lines = text.trim().split(LINE_SPLIT_SEPARATOR)
  return lines.slice(-OUTPUT_PREVIEW_LINES).join('\n')
}
