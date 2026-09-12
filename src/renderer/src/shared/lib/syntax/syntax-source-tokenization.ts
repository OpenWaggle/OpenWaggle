import type { GrammarState, HighlighterCore } from 'shiki'

const ESTIMATED_TOKEN_LINE_BYTES = 24
const ESTIMATED_TOKEN_BASE_BYTES = 48
const UTF16_CODE_UNIT_BYTES = 2

/** A resumable prefix. Unrequested trailing lines never delay the visible viewport. */
export class SyntaxSourceTokenization {
  readonly tokens: ReturnType<HighlighterCore['codeToTokens']>['tokens'] = []
  foreground: string | undefined
  background: string | undefined
  estimatedBytes: number
  private nextOffset = 0
  private complete = false
  private grammarState: GrammarState | undefined

  constructor(private readonly source: string) {
    // The source stays in this worker so subsequent viewports need no IPC retransmission.
    this.estimatedBytes = source.length * UTF16_CODE_UNIT_BYTES
  }

  highlightThrough(
    instance: HighlighterCore,
    language: string,
    theme: string,
    endLine = Number.POSITIVE_INFINITY,
  ) {
    if (this.complete || this.tokens.length >= endLine) return
    let complete = false
    let endOffset = this.nextOffset
    let nextOffset = this.nextOffset
    for (let line = this.tokens.length; line < endLine; line += 1) {
      const newline = this.source.indexOf('\n', nextOffset)
      if (newline < 0) {
        endOffset = this.source.length
        nextOffset = this.source.length
        complete = true
        break
      }
      // Do not tokenize a synthetic empty line after the chunk: its grammar state
      // can differ from the actual next line. Consume the delimiter separately.
      endOffset = this.source[newline - 1] === '\r' ? newline - 1 : newline
      nextOffset = newline + 1
    }
    const result = instance.codeToTokens(this.source.slice(this.nextOffset, endOffset), {
      lang: language,
      theme,
      ...(this.grammarState ? { grammarState: this.grammarState } : {}),
    })
    this.nextOffset = nextOffset
    this.complete = complete
    this.grammarState = result.grammarState
    this.foreground = result.fg
    this.background = result.bg
    for (const line of result.tokens) {
      this.tokens.push(line)
      this.estimatedBytes += ESTIMATED_TOKEN_LINE_BYTES
      for (const token of line) {
        this.estimatedBytes +=
          ESTIMATED_TOKEN_BASE_BYTES + token.content.length * UTF16_CODE_UNIT_BYTES
      }
    }
  }
}
