/**
 * Reads a shell command line the way bash would split it, so the guardrail rules look at each
 * command's argv instead of the raw text. Quoted text stays one argument (`git commit -m "drop
 * -n"` has no `-n` flag), and only text the shell would run counts as a command: `;`, `&&`,
 * `||`, `|` and newlines split commands, `$(...)`, backticks and `<(...)` run nested scripts, and a
 * here-document or here-string feeds its text to the command that opened it.
 *
 * This is not a full shell. Variables stay unexpanded and aliases are unknown; it is a guard
 * against agent mistakes, not a security boundary.
 */
import { CommandBuilder, type RawCommand } from './shell-commands'
import {
  PAIR,
  type Read,
  TRIPLE,
  ansiQuoted,
  arithmeticEnd,
  backtickScript,
  heredocBody,
  indexOrEnd,
  redirectionOperator,
  singleQuoted,
} from './shell-readers'

export type { RawCommand } from './shell-commands'

// Deeper nesting than this is not read; no agent command comes close.
export const MAX_SHELL_NESTING = 6
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n'])
const COMMAND_SEPARATORS = new Set([';', '&'])
const OPERATOR_CHARS = new Set(['<', '>', '&', ';', '|', '(', ')'])

class Scanner {
  index: number
  readonly builder = new CommandBuilder()
  private parenDepth = 0

  private readonly text: string
  private readonly closesOnParen: boolean
  private readonly depth: number

  constructor(text: string, start: number, closesOnParen: boolean, depth: number) {
    this.text = text
    this.index = start
    this.closesOnParen = closesOnParen
    this.depth = depth
  }

  /** Scans to the end of the text, or to the `)` that closes a nested scan. */
  scan() {
    if (this.depth > MAX_SHELL_NESTING) {
      this.index = this.text.length
      return this
    }
    while (this.index < this.text.length && !this.step()) {
      // Each step reads one token.
    }
    this.builder.endCommand(false)
    return this
  }

  /** Reads the `$(...)` or backtick script at the cursor, for here-document bodies. */
  scanOneSubstitution() {
    if (!this.readSubstitution()) {
      this.index += 1
    }
    return this
  }

  /** Reads one token; true when it read the `)` that closes a nested scan. */
  private step(): boolean {
    const char = this.text[this.index] ?? ''
    const next = this.text[this.index + 1]
    if (char === '\\') {
      this.index += PAIR
      // A backslash before a newline continues the line and adds nothing to the word.
      if (next !== '\n') {
        this.builder.append(next ?? '', true)
      }
      return false
    }
    if (char === "'" || (char === '$' && next === "'")) {
      this.appendRead(
        char === "'" ? singleQuoted(this.text, this.index) : ansiQuoted(this.text, this.index),
      )
      return false
    }
    if (char === '"') {
      this.readDoubleQuoted()
      return false
    }
    if (this.readSubstitution()) {
      return false
    }
    if (this.readSeparator(char)) {
      return false
    }
    if (!OPERATOR_CHARS.has(char)) {
      this.builder.append(char, false)
      this.index += 1
      return false
    }
    return this.readOperator(char, next)
  }

  /** Blanks, newlines and comments; true when it read one. */
  private readSeparator(char: string) {
    if (char === ' ' || char === '\t') {
      this.builder.endWord()
      this.index += 1
      return true
    }
    if (char === '\n') {
      this.builder.endCommand(false)
      this.index += 1
      this.readHeredocBodies()
      return true
    }
    if (char === '#' && !this.builder.hasWord) {
      this.index = indexOrEnd(this.text, '\n', this.index)
      return true
    }
    return false
  }

  private readOperator(char: string, next: string | undefined): boolean {
    if ((char === '<' || char === '>') && next === '(') {
      this.builder.endWord()
      this.readNested(this.index + PAIR)
      this.builder.append('/dev/fd/63', false)
      return false
    }
    if (char === '<' || char === '>' || (char === '&' && next === '>')) {
      this.readRedirection()
      return false
    }
    if (COMMAND_SEPARATORS.has(char) || char === '|') {
      this.builder.endCommand(char === '|' && next !== '|')
      this.index += next === char || (char === '|' && next === '&') ? PAIR : 1
      return false
    }
    this.builder.endCommand(false)
    this.index += 1
    if (char === '(') {
      this.parenDepth += 1
      return false
    }
    return this.closeParen()
  }

  /** After `)`: true when it closes this nested scan. */
  private closeParen() {
    // In `case x in a) cmd ;; esac` the `)` ends a pattern.
    if (this.builder.inCase) {
      return false
    }
    if (this.parenDepth > 0) {
      this.parenDepth -= 1
      return false
    }
    return this.closesOnParen
  }

  private readSubstitution(): boolean {
    const char = this.text[this.index]
    const next = this.text[this.index + 1]
    if (char === '$' && next === '(' && this.text[this.index + PAIR] === '(') {
      this.index = arithmeticEnd(this.text, this.index)
      this.builder.append('0', false)
      return true
    }
    if (char === '$' && next === '(') {
      this.readNested(this.index + PAIR)
      this.builder.append('', false)
      return true
    }
    if (char !== '`') {
      return false
    }
    const script = backtickScript(this.text, this.index)
    this.index = script.end
    this.builder.add(new Scanner(script.text, 0, false, this.depth + 1).scan().builder.commands)
    this.builder.append('', false)
    return true
  }

  private readNested(start: number) {
    const nested = new Scanner(this.text, start, true, this.depth + 1).scan()
    this.builder.add(nested.builder.commands)
    this.index = nested.index
  }

  private readDoubleQuoted() {
    this.index += 1
    this.builder.append('', true)
    while (this.index < this.text.length && this.text[this.index] !== '"') {
      if (this.readSubstitution()) {
        continue
      }
      const char = this.text[this.index] ?? ''
      const next = this.text[this.index + 1] ?? ''
      const escaped = char === '\\' && DOUBLE_QUOTE_ESCAPES.has(next)
      this.builder.append(escaped ? next.replace('\n', '') : char, true)
      this.index += escaped ? PAIR : 1
    }
    this.index += 1
  }

  private readRedirection() {
    this.builder.dropDescriptorDigits()
    const rest = this.text.slice(this.index)
    if (rest.startsWith('<<<')) {
      this.index += TRIPLE
      this.builder.expectRedirectTarget('here-string')
      return
    }
    if (rest.startsWith('<<')) {
      const stripTabs = rest[PAIR] === '-'
      this.index += stripTabs ? TRIPLE : PAIR
      this.builder.expectHeredocDelimiter(stripTabs)
      return
    }
    const operator = redirectionOperator(rest)
    this.index += operator.length
    if (operator === '<' || operator === '<&') {
      this.builder.expectRedirectTarget('read-target')
      return
    }
    this.builder.expectRedirectTarget(operator === '>&' ? 'write-or-descriptor' : 'write-target')
  }

  private readHeredocBodies() {
    for (const heredoc of this.builder.takeHeredocs()) {
      const body = heredocBody(this.text, this.index, heredoc.delimiter, heredoc.stripTabs)
      this.index = body.end
      if (!heredoc.quoted) {
        this.builder.add(substitutionsIn(body.text, this.depth + 1))
      }
      const { stdin } = heredoc.command
      heredoc.command.stdin = stdin === undefined ? body.text : `${stdin}\n${body.text}`
    }
  }

  private appendRead(read: Read) {
    this.builder.append(read.text, true)
    this.index = read.end
  }
}

/** The commands in the `$(...)` and backticks of an unquoted here-document body. */
function substitutionsIn(body: string, depth: number): RawCommand[] {
  const commands: RawCommand[] = []
  let index = 0
  while (index < body.length) {
    const char = body[index]
    if (char === '\\') {
      index += PAIR
      continue
    }
    if ((char === '$' && body[index + 1] === '(') || char === '`') {
      const scanner = new Scanner(body, index, false, depth).scanOneSubstitution()
      commands.push(...scanner.builder.commands)
      index = scanner.index
      continue
    }
    index += 1
  }
  return commands
}

/** Every command bash would run for `script`, nested scripts included, in no particular order. */
export function scanShell(script: string): readonly RawCommand[] {
  return new Scanner(script, 0, false, 0).scan().builder.commands
}
