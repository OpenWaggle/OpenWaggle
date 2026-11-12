import { match, P } from '@diegogbrisa/ts-match'
import { isRecord } from '@shared/utils/validation'
import {
  getToolResultDetails,
  isTextContentBlock,
  LINE_SPLIT_SEPARATOR,
  parseResultPayload,
} from './tool-call-block'

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

const PI_EDIT_RESULT_OPENING = /^Successfully replaced \d+ block\(s\) in /u
const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)+/u
const LEADING_LINE_SPACE = /^[ \t]*(?:\r?\n)?/u
const STARTS_WITH_WHITESPACE = /^\s/u
const SENTENCE_BREAK = '. '

/**
 * What follows Pi's own sentence for exactly `path` at the start of `text`, or null when
 * `text` does not start with it. Compared literally: the path is untrusted and can be
 * long enough that a pattern built from it would not compile.
 */
function afterExactPiSentence(text: string, path: string): string | null {
  const opening = PI_EDIT_RESULT_OPENING.exec(text)
  if (!opening) return null
  const sentence = `${path}.`
  const rest = text.slice(opening[0].length)
  if (!rest.startsWith(sentence)) return null
  const tail = rest.slice(sentence.length)
  if (tail !== '' && !STARTS_WITH_WHITESPACE.test(tail)) return null
  return tail.replace(LEADING_LINE_SPACE, '')
}

/**
 * Whether `line` is Pi's sentence and nothing else, for a path the row cannot name
 * (an extension rewrote it, or the arguments carry none). A reported path containing a
 * sentence break is taken as appended text instead, so nothing is lost.
 */
function isWholePiSentence(line: string) {
  const opening = PI_EDIT_RESULT_OPENING.exec(line)
  if (!opening) return false
  const reported = line.slice(opening[0].length).trimEnd()
  return reported.length > 1 && reported.endsWith('.') && !reported.includes(SENTENCE_BREAK)
}

/** Applies `replace` to the first line, in block order, it accepts; null when none does. */
function replaceFirstLine(
  blocks: readonly string[],
  replace: (line: string) => string | null,
): string[] | null {
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block.split(LINE_SPLIT_SEPARATOR)
    const lineIndex = lines.findIndex((line) => replace(line) !== null)
    if (lineIndex === -1) continue
    const replacement = replace(lines[lineIndex] ?? '') ?? ''
    const kept = replacement.trim() === '' ? [] : [replacement]
    const updated = [...lines.slice(0, lineIndex), ...kept, ...lines.slice(lineIndex + 1)]
    return blocks.map((text, index) => (index === blockIndex ? updated.join('\n') : text))
  }
  return null
}

/**
 * Removes Pi's own line, which the diff already says, once: where Pi puts it (opening
 * the first block, possibly followed by text an extension appended on the same line),
 * else on any line for the edited path, else as a whole line for any path, which covers
 * an extension that put its block first or rewrote the path Pi reports.
 */
function withoutPiEditResultLine(blocks: readonly string[], path: string | null) {
  const [first = '', ...rest] = blocks
  if (path !== null) {
    const opening = afterExactPiSentence(first.replace(LEADING_BLANK_LINES, ''), path)
    if (opening !== null) return [opening, ...rest]
    const exact = replaceFirstLine(blocks, (line) => afterExactPiSentence(line, path))
    if (exact) return exact
  }
  return replaceFirstLine(blocks, (line) => (isWholePiSentence(line) ? '' : null)) ?? blocks
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
