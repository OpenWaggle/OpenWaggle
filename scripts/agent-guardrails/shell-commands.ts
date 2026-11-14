/**
 * Builds the scanner's commands word by word (`shell-scanner.ts` reads the text, this keeps the
 * words): routes each finished word to the command's arguments, a redirection target, a
 * here-string, or a here-document delimiter.
 */

/** One command as the scanner found it: words with quotes removed, plus its redirections. */
export interface RawCommand {
  readonly words: string[]
  /** Files its output redirections (`>`, `>>`, `&>`, `>|`) write. */
  readonly writes: string[]
  /** Text a here-document or here-string feeds it. */
  stdin: string | undefined
  /** Whether it reads the output of a pipe (`a | b`). */
  readonly piped: boolean
}

export type RedirectTarget = 'write-target' | 'write-or-descriptor' | 'read-target' | 'here-string'

export interface PendingHeredoc {
  readonly delimiter: string
  readonly stripTabs: boolean
  /** A quoted delimiter keeps the body literal; otherwise bash runs its `$(...)`. */
  readonly quoted: boolean
  readonly command: RawCommand
}

const DIGITS = /^\d+$/
const DESCRIPTOR = /^(?:\d+-?|-)$/

function newCommand(piped: boolean) {
  const command: RawCommand = { words: [], writes: [], stdin: undefined, piped }
  return command
}

export class CommandBuilder {
  readonly commands: RawCommand[] = []
  private word: string | undefined = undefined
  private wordQuoted = false
  private command: RawCommand = newCommand(false)
  private nextWord: RedirectTarget | 'argument' = 'argument'
  private heredocNext: { readonly stripTabs: boolean } | undefined = undefined
  private heredocs: PendingHeredoc[] = []
  private caseDepth = 0

  /** Inside `case ... esac`, where `)` ends a pattern. */
  get inCase() {
    return this.caseDepth > 0
  }

  get hasWord() {
    return this.word !== undefined
  }

  append(text: string, quoted: boolean) {
    this.word = (this.word ?? '') + text
    this.wordQuoted ||= quoted
  }

  /** Before a redirection: in `2>&1` the digits right before `>` name a descriptor. */
  dropDescriptorDigits() {
    if (this.word !== undefined && !this.wordQuoted && DIGITS.test(this.word)) {
      this.word = undefined
    }
  }

  expectRedirectTarget(target: RedirectTarget) {
    this.endWord()
    this.nextWord = target
  }

  expectHeredocDelimiter(stripTabs: boolean) {
    this.endWord()
    this.heredocNext = { stripTabs }
  }

  /** The here-documents opened on the line that just ended, in order. */
  takeHeredocs() {
    const pending = this.heredocs
    this.heredocs = []
    return pending
  }

  add(commands: readonly RawCommand[]) {
    this.commands.push(...commands)
  }

  endWord() {
    const { word, wordQuoted } = this
    if (word === undefined) {
      return
    }
    this.word = undefined
    this.wordQuoted = false
    if (this.heredocNext !== undefined) {
      this.heredocs.push({
        delimiter: word,
        quoted: wordQuoted,
        command: this.command,
        ...this.heredocNext,
      })
      this.heredocNext = undefined
      return
    }
    const target = this.nextWord
    this.nextWord = 'argument'
    if (target === 'argument') {
      this.addArgument(word)
      return
    }
    if (target === 'here-string') {
      this.command.stdin = word
      return
    }
    if (target === 'write-target' || (target === 'write-or-descriptor' && !DESCRIPTOR.test(word))) {
      this.command.writes.push(word)
    }
  }

  private addArgument(word: string) {
    if (this.command.words.length === 0) {
      this.caseDepth += Number(word === 'case') - Number(word === 'esac' && this.caseDepth > 0)
    }
    this.command.words.push(word)
  }

  endCommand(pipesIntoNext: boolean) {
    this.endWord()
    this.nextWord = 'argument'
    this.heredocNext = undefined
    const { command } = this
    if (command.words.length > 0 || command.writes.length > 0 || command.stdin !== undefined) {
      this.commands.push(command)
    }
    // `a |` followed by a newline still feeds the next command.
    const carriesPipe = command.piped && command.words.length === 0
    this.command = newCommand(pipesIntoNext || carriesPipe)
  }
}
