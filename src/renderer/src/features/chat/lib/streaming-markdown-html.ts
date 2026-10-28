/** The HTML blocks the streaming Markdown splitter must keep whole (CommonMark HTML blocks). */

/** An HTML block runs to the next blank line, past any fence line inside it. */
export const HTML_BLOCK_START_PATTERN = /^ {0,3}</u
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
export function rawHtmlBlockEnd(line: string) {
  const kind = RAW_HTML_BLOCKS.find((candidate) => candidate.start.test(line))
  if (!kind) return null
  const opening = line.match(kind.start)?.[0].length ?? 0
  return kind.end.test(line.slice(opening)) ? null : kind.end
}
