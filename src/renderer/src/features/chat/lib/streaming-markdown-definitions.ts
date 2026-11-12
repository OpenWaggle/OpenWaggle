/**
 * Link reference definitions in streaming Markdown (review V1 P3-4). A definition makes references
 * in every block resolve, so `splitStreamingMarkdown` collects the plain ones (one line, at the
 * start of a block or after another definition) and each block is parsed with the ones it
 * mentions in front of it. Any other definition (a footnote, one in a quote or list item, one over
 * several lines) makes the text one document again.
 */

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

type PreviousLine = 'start' | 'blank' | 'definition' | 'other'

/** The text's plain definitions, and whether it holds another kind that needs one document. */
export class DefinitionCollector {
  readonly lines: string[] = []
  needsWholeDocument = false
  private previous: PreviousLine = 'start'

  read(text: string, literal: boolean) {
    if (literal) {
      this.previous = 'other'
      return
    }
    if (text.trim().length === 0) {
      this.previous = 'blank'
      return
    }
    if (!REFERENCE_DEFINITION_PATTERN.test(text)) {
      this.previous = 'other'
      return
    }
    // A definition cannot interrupt a paragraph, so a plain one starts a block.
    const plain = this.previous !== 'other' && PLAIN_DEFINITION_PATTERN.test(text)
    if (plain) this.lines.push(text.trim())
    else this.needsWholeDocument = true
    this.previous = plain ? 'definition' : 'other'
  }
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
