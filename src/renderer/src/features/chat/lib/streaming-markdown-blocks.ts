/**
 * Splits streaming Markdown into completed blocks and a live tail (B9, ADR 0026).
 *
 * A completed block never changes again while the answer streams, so it is parsed and rendered
 * once; only the tail is re-read per token. Blocks end:
 * - after a blank line outside fenced code, once the next non-blank line shows it does not continue
 *   the block: a list continues across a blank line into an indented line or the next item, and
 *   any block into a line indented as code (or as a footnote's or list item's next paragraph);
 * - before a fence that opens at column 0 (a fence ends any paragraph, list, quote, or table above
 *   it), and after that fence's closing line.
 *
 * Each block is parsed as a document of its own, so a block must never end where the whole text
 * would read on: a loose list cut at its blank lines rendered as several lists and paragraphs while
 * streaming, and as one list once settled.
 *
 * A tail that is a column-0 fence still open is code the reader sees as plain text until it
 * closes, so it is not parsed at all: re-parsing a long open fence on every token was quadratic.
 *
 * A link reference definition makes references in every block resolve. A plain one (one line, at
 * the start of a block or after another definition) leaves the split as it is: each block and the
 * live tail is parsed with the definitions it mentions put in front of it
 * (`withReferenceDefinitions`). Any other definition (a footnote, one inside a quote, one over
 * several lines) makes the text one document again. Lines in fenced code and raw HTML are never
 * definitions, so a Markdown or INI example in a fence never costs the split (review V1 P3-4).
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
  /** The text's link reference definitions, one per line in text order; '' without any. */
  readonly definitions: string
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
const TAB = '\t'
/** A tab moves to the next multiple of four columns, as CommonMark reads indentation. */
const TAB_STOP = 4
/** Indented this far, a line is code, or the next paragraph of a footnote or list item. */
const INDENTED_CODE_COLUMNS = 4
/** A list item's marker: a bullet, or up to nine digits with `.` or `)`, then a space or the end. */
const LIST_MARKER_PATTERN = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/u
/** A line still streaming that may yet become a list marker. */
const PARTIAL_LIST_MARKER_PATTERN = /^(?:[-+*]|\d{1,9}[.)]?)$/u

/**
 * A line that may hold a link reference or footnote definition: inside quotes and list items too,
 * where definitions are still global.
 */
const REFERENCE_DEFINITION_PATTERN = /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?\[[^\]\n]+\]:/u
/**
 * A whole link reference definition on one line, at most three columns in: its label (not a
 * footnote's `^`), its destination, and an optional title.
 */
const PLAIN_DEFINITION_PATTERN =
  /^ {0,3}\[(?<label>[^\]\n^][^\]\n]*)\]:[ \t]*(?:<[^<>\n]*>|[^<\s]\S*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/u
/** An HTML block runs to the next blank line, past any fence line inside it. */
const HTML_BLOCK_START_PATTERN = /^ {0,3}</u
/**
 * The HTML blocks that run past blank lines, to their end marker (CommonMark HTML block kinds 1–5):
 * raw text elements, comments, processing instructions, declarations and CDATA.
 */
const RAW_HTML_BLOCKS: ReadonlyArray<{ readonly start: RegExp; readonly end: RegExp }> = [
  {
    start: /^ {0,3}<(?:pre|script|style|textarea)(?:[\s>]|$)/iu,
    end: /<\/(?:pre|script|style|textarea)>/iu,
  },
  { start: /^ {0,3}<!--/u, end: /-->/u },
  { start: /^ {0,3}<\?/u, end: /\?>/u },
  { start: /^ {0,3}<![A-Za-z]/u, end: />/u },
  { start: /^ {0,3}<!\[CDATA\[/u, end: /\]\]>/u },
]

/** The end marker of a raw HTML block the line opens and does not close, if any. */
function rawHtmlBlockEnd(line: string) {
  const kind = RAW_HTML_BLOCKS.find((candidate) => candidate.start.test(line))
  if (!kind) return null
  const opening = line.match(kind.start)?.[0].length ?? 0
  return kind.end.test(line.slice(opening)) ? null : kind.end
}

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

/** The line's indentation in columns, and the text after it. */
function indentation(line: string) {
  let columns = 0
  let index = 0
  while (index < line.length && (line[index] === SPACE || line[index] === TAB)) {
    columns = line[index] === TAB ? columns + TAB_STOP - (columns % TAB_STOP) : columns + 1
    index += 1
  }
  return { columns, rest: line.slice(index) }
}

/** A list item's line, at most three columns in, as CommonMark starts one. */
function isListItemLine(line: string) {
  const { columns, rest } = indentation(line)
  return columns < INDENTED_CODE_COLUMNS && LIST_MARKER_PATTERN.test(rest)
}

type Continuation = 'continues' | 'ends' | 'undecided'

/**
 * Whether the first non-blank line after a blank line continues the block above it. Unsure means
 * it continues: parsing two blocks together reads them as the whole text does.
 */
function continuation(line: MarkdownLine, blockHasList: boolean): Continuation {
  const { columns, rest } = indentation(line.text)
  if (columns >= INDENTED_CODE_COLUMNS) return 'continues'
  if (!blockHasList) return 'ends'
  if (columns > 0) return 'continues'
  if (LIST_MARKER_PATTERN.test(rest)) return 'continues'
  return !line.complete && PARTIAL_LIST_MARKER_PATTERN.test(rest) ? 'undecided' : 'ends'
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
  private blockHasList = false
  /** After the block's first blank line: where it ends unless the next non-blank line goes on. */
  private blankEnd: number | null = null
  /** The end marker of the raw HTML block open here: blank lines inside it end nothing. */
  private rawHtmlEnd: RegExp | null = null

  /** Inside fenced code or a raw HTML block, where no line is a definition. */
  inLiteralBlock() {
    return this.fence !== null || this.rawHtmlEnd !== null
  }

  /** Ends the block at `offset`; blank lines before a block's content stay with that block. */
  endBlockAt(offset: number) {
    if (this.blockHasContent && offset > this.blockStart) {
      this.boundaries.push(offset)
      this.blockStart = offset
    }
    this.blockHasHtml = false
    this.blockHasContent = false
    this.blockHasList = false
    this.blankEnd = null
    this.rawHtmlEnd = null
  }

  /** Ends the block at its blank line unless `line` continues it; `false` while that is unknown. */
  private resolveBlankLine(line: MarkdownLine) {
    if (this.blankEnd === null || isBlank(line.text)) return true
    const next = continuation(line, this.blockHasList)
    if (next === 'undecided') return false
    if (next === 'ends') this.endBlockAt(this.blankEnd)
    else this.blankEnd = null
    return true
  }

  private readRawHtml(line: MarkdownLine, end: RegExp) {
    if (!line.complete) return false
    if (end.test(line.text)) this.rawHtmlEnd = null
    return true
  }

  private readFenced(line: MarkdownLine, run: FenceRun | null, fence: Fence) {
    // A closing line still streaming already closes it: CommonMark closes a fence at the end.
    if (!closesFence(run, fence)) return true
    this.fence = null
    if (line.complete && fence.topLevel) this.endBlockAt(line.end)
    return true
  }

  private openFence(line: MarkdownLine, run: FenceRun) {
    const topLevel = run.indent === 0 && !this.blockHasHtml
    if (topLevel) this.endBlockAt(line.start)
    this.fence = { character: run.character, length: run.length, topLevel, start: line.start }
    this.blockHasContent = true
    return true
  }

  /** Reads one line; `false` once a line still streaming ends the scan. */
  read(line: MarkdownLine) {
    const run = fenceRun(line.text)
    const fence = this.fence
    if (!fence && !this.resolveBlankLine(line)) return false
    if (this.rawHtmlEnd) return this.readRawHtml(line, this.rawHtmlEnd)
    if (fence) return this.readFenced(line, run, fence)
    if (run && opensFence(run)) return this.openFence(line, run)
    const blank = isBlank(line.text)
    if (!line.complete) {
      this.blockHasContent ||= !blank
      return false
    }
    if (blank) {
      if (this.blockHasContent) this.blankEnd ??= line.end
      return true
    }
    this.blockHasContent = true
    this.blockHasHtml ||= HTML_BLOCK_START_PATTERN.test(line.text)
    this.blockHasList ||= isListItemLine(line.text)
    this.rawHtmlEnd = rawHtmlBlockEnd(line.text)
    return true
  }
}

function completedBlocks(text: string, boundaries: readonly number[]): StreamingMarkdownBlock[] {
  return boundaries.map((end, index) => {
    const start = boundaries[index - 1] ?? 0
    return { start, text: text.slice(start, end) }
  })
}

type PreviousLine = 'start' | 'blank' | 'definition' | 'other'

/** The text's plain definitions, and whether it holds another kind that needs one document. */
class DefinitionCollector {
  readonly lines: string[] = []
  needsWholeDocument = false
  private previous: PreviousLine = 'start'

  read(line: MarkdownLine, literal: boolean) {
    if (literal) {
      this.previous = 'other'
      return
    }
    if (isBlank(line.text)) {
      this.previous = 'blank'
      return
    }
    if (!REFERENCE_DEFINITION_PATTERN.test(line.text)) {
      this.previous = 'other'
      return
    }
    // A definition cannot interrupt a paragraph, so a plain one starts a block.
    const plain = this.previous !== 'other' && PLAIN_DEFINITION_PATTERN.test(line.text)
    if (plain) this.lines.push(line.text.trim())
    else this.needsWholeDocument = true
    this.previous = plain ? 'definition' : 'other'
  }
}

function scan(text: string) {
  const scanner = new BlockBoundaryScanner()
  const definitions = new DefinitionCollector()
  for (const line of markdownLines(text)) {
    definitions.read(line, scanner.inLiteralBlock())
    if (!scanner.read(line)) break
  }
  return { scanner, definitions }
}

/** A label as references match it: case-insensitive, with runs of whitespace as one space. */
function normalizedLabel(label: string) {
  return label.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/**
 * `markdown` with the `definitions` it may refer to in front of it, so it parses as it does in the
 * whole text. A definition renders nothing; one whose label the text never mentions is left out,
 * so a block parses again only when a definition it uses arrives.
 */
export function withReferenceDefinitions(markdown: string, definitions: string) {
  if (!definitions) return markdown
  const mentioned = normalizedLabel(markdown)
  const used = definitions.split('\n').filter((line) => {
    const label = PLAIN_DEFINITION_PATTERN.exec(line)?.groups?.label
    return label !== undefined && mentioned.includes(normalizedLabel(label))
  })
  return used.length > 0 ? `${used.join('\n')}\n\n${markdown}` : markdown
}

/**
 * The blocks of text that ends where a split ended a block (the text before a split's tail): the
 * same blocks the split found there, its end included, though no line after it shows it ended.
 */
export function completedMarkdownBlocks(prefix: string): StreamingMarkdownBlock[] {
  const { scanner } = scan(prefix)
  scanner.endBlockAt(prefix.length)
  return completedBlocks(prefix, scanner.boundaries)
}

export function splitStreamingMarkdown(text: string): StreamingMarkdownSplit {
  const { scanner, definitions: collected } = scan(text)
  if (collected.needsWholeDocument) {
    return {
      blocks: [],
      tail: text ? { kind: 'markdown', start: 0, text } : null,
      definitions: '',
    }
  }
  const definitions = collected.lines.join('\n')
  const blocks = completedBlocks(text, scanner.boundaries)
  const prefixEnd = scanner.boundaries.at(-1) ?? 0
  if (prefixEnd >= text.length) return { blocks, tail: null, definitions }
  const fence = scanner.fence
  if (fence?.topLevel && isBlank(text.slice(prefixEnd, fence.start))) {
    return {
      blocks,
      tail: { kind: 'open-fence', start: prefixEnd, ...fencedCode(text, fence) },
      definitions,
    }
  }
  return {
    blocks,
    tail: { kind: 'markdown', start: prefixEnd, text: text.slice(prefixEnd) },
    definitions,
  }
}
