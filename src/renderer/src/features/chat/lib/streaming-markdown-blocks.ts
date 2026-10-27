/**
 * Splits streaming Markdown into completed blocks and a live tail (B9, ADR 0026).
 *
 * A completed block never changes again while the answer streams, so it is parsed and rendered
 * once; only the tail is re-read per token. Blocks end:
 * - after a blank line outside fenced code;
 * - before a fence that opens at column 0 (a fence ends any paragraph, list, quote, or table above
 *   it), and after that fence's closing line.
 *
 * A tail that is a column-0 fence still open is code the reader sees as plain text until it
 * closes, so it is not parsed at all: re-parsing a long open fence on every token was quadratic.
 *
 * The scan reads each line's first characters only, so a whole-answer rescan per token is cheap
 * and keeps the split a pure function of the text.
 */

export interface StreamingMarkdownBlock {
  /** Offset of the block in the streamed text; stable while the text only grows. */
  readonly start: number
  readonly text: string
}

export type StreamingMarkdownTail =
  | { readonly kind: 'markdown'; readonly start: number; readonly text: string }
  | {
      readonly kind: 'open-fence'
      readonly start: number
      /** The info string's first word, as Markdown names a fenced block's language. */
      readonly language: string | null
      /** The fenced lines so far, without the opening line. */
      readonly code: string
    }

export interface StreamingMarkdownSplit {
  readonly blocks: readonly StreamingMarkdownBlock[]
  readonly tail: StreamingMarkdownTail | null
}

interface Fence {
  readonly character: '`' | '~'
  readonly length: number
  /** Opened at column 0: its edges are block boundaries. */
  readonly topLevel: boolean
  readonly start: number
}

const BACKTICK = '`'
const TILDE = '~'
const MIN_FENCE_LENGTH = 3
const MAX_FENCE_INDENT = 3
const SPACE = ' '

/**
 * A link reference definition anywhere: one makes links in other blocks resolve, so blocks that
 * hold one are parsed together. Matches inside quotes and list items too, where definitions are
 * still global.
 */
const REFERENCE_DEFINITION_PATTERN = /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?\[[^\]\n]+\]:/mu
/** An HTML block runs to the next blank line, past any fence line inside it. */
const HTML_BLOCK_START_PATTERN = /^ {0,3}</u

interface FenceRun {
  readonly character: '`' | '~'
  readonly length: number
  readonly indent: number
  readonly trailing: string
}

function fenceRun(line: string): FenceRun | null {
  let indent = 0
  while (indent < line.length && line[indent] === SPACE) indent += 1
  if (indent > MAX_FENCE_INDENT) return null
  const character = line[indent]
  if (character !== BACKTICK && character !== TILDE) return null
  let end = indent
  while (end < line.length && line[end] === character) end += 1
  const length = end - indent
  if (length < MIN_FENCE_LENGTH) return null
  return { character, length, indent, trailing: line.slice(end) }
}

function opensFence(run: FenceRun) {
  // A backtick fence's info string may not contain a backtick.
  return run.character !== BACKTICK || !run.trailing.includes(BACKTICK)
}

function closesFence(run: FenceRun | null, fence: Fence) {
  return (
    run !== null &&
    run.character === fence.character &&
    run.length >= fence.length &&
    run.trailing.trim().length === 0
  )
}

function isBlank(line: string) {
  return line.trim().length === 0
}

function fenceLanguage(openingLine: string) {
  const run = fenceRun(openingLine)
  const word = run?.trailing.trim().split(/\s/u)[0]
  return word ? word : null
}

function fencedCode(text: string, fence: Fence) {
  const openingEnd = text.indexOf('\n', fence.start)
  if (openingEnd < 0) return { language: fenceLanguage(text.slice(fence.start)), code: '' }
  return {
    language: fenceLanguage(text.slice(fence.start, openingEnd).replace(/\r$/u, '')),
    code: text.slice(openingEnd + 1),
  }
}

interface MarkdownLine {
  readonly text: string
  readonly start: number
  /** Offset after its line ending; the end of the text for a line still streaming. */
  readonly end: number
  /** Ended by a newline: a line still streaming may change. */
  readonly complete: boolean
}

function* markdownLines(text: string): Generator<MarkdownLine> {
  let cursor = 0
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor)
    const complete = newline >= 0
    const end = complete ? newline + 1 : text.length
    const lineText = text.slice(cursor, complete ? newline : text.length).replace(/\r$/u, '')
    yield { text: lineText, start: cursor, end, complete }
    cursor = end
  }
}

/** Where completed blocks end, and the fence open at the end of the text, if any. */
class BlockBoundaryScanner {
  readonly boundaries: number[] = []
  fence: Fence | null = null
  private blockStart = 0
  private blockHasHtml = false
  private blockHasContent = false

  /** Ends the block at `offset`; blank lines before a block's content stay with that block. */
  private endBlockAt(offset: number) {
    if (this.blockHasContent && offset > this.blockStart) {
      this.boundaries.push(offset)
      this.blockStart = offset
    }
    this.blockHasHtml = false
    this.blockHasContent = false
  }

  /** Reads one line; `false` once a line still streaming ends the scan. */
  read(line: MarkdownLine) {
    const run = fenceRun(line.text)
    const fence = this.fence
    if (fence) {
      // A closing line still streaming already closes it: CommonMark closes a fence at the end.
      if (!closesFence(run, fence)) return true
      this.fence = null
      if (line.complete && fence.topLevel) this.endBlockAt(line.end)
      return true
    }
    if (run && opensFence(run)) {
      const topLevel = run.indent === 0 && !this.blockHasHtml
      if (topLevel) this.endBlockAt(line.start)
      this.fence = { character: run.character, length: run.length, topLevel, start: line.start }
      this.blockHasContent = true
      return true
    }
    const blank = isBlank(line.text)
    if (!line.complete) {
      this.blockHasContent ||= !blank
      return false
    }
    if (blank) {
      this.endBlockAt(line.end)
      return true
    }
    this.blockHasContent = true
    this.blockHasHtml ||= HTML_BLOCK_START_PATTERN.test(line.text)
    return true
  }
}

function completedBlocks(text: string, boundaries: readonly number[]): StreamingMarkdownBlock[] {
  const prefix = text.slice(0, boundaries.at(-1) ?? 0)
  if (REFERENCE_DEFINITION_PATTERN.test(prefix)) return [{ start: 0, text: prefix }]
  return boundaries.map((end, index) => {
    const start = boundaries[index - 1] ?? 0
    return { start, text: text.slice(start, end) }
  })
}

export function splitStreamingMarkdown(text: string): StreamingMarkdownSplit {
  const scanner = new BlockBoundaryScanner()
  for (const line of markdownLines(text)) {
    if (!scanner.read(line)) break
  }
  const blocks = completedBlocks(text, scanner.boundaries)
  const prefixEnd = scanner.boundaries.at(-1) ?? 0
  if (prefixEnd >= text.length) return { blocks, tail: null }
  const fence = scanner.fence
  if (fence?.topLevel && isBlank(text.slice(prefixEnd, fence.start))) {
    return { blocks, tail: { kind: 'open-fence', start: prefixEnd, ...fencedCode(text, fence) } }
  }
  return { blocks, tail: { kind: 'markdown', start: prefixEnd, text: text.slice(prefixEnd) } }
}
