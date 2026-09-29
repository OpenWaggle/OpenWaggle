import { sanitizeTerminalText } from './terminal-text'

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export interface RunCliOutputSinks {
  readonly writeStdout: (text: string) => Promise<void>
  readonly writeStderr: (text: string) => void
  /** Reply text is sanitized only when it goes to a terminal; piped output is left intact. */
  readonly stdoutIsTerminal: boolean
}

/**
 * One ordered queue for both streams. Writing stderr synchronously while stdout waited on a
 * promise let a progress line land before the newline that should have ended the reply line.
 */
export class RunCliOutput {
  private queue = Promise.resolve()
  private stdoutFailed = false

  constructor(
    private readonly sinks: RunCliOutputSinks,
    private readonly onStdoutFailure: (error: unknown) => void,
  ) {}

  private heldGrapheme = ''

  private enqueue(write: () => Promise<void> | void) {
    this.queue = this.queue.then(write)
  }

  /** Agent reply text. Stops quietly after the reader goes away (for example, `| head`). */
  reply(text: string) {
    if (!this.sinks.stdoutIsTerminal) {
      this.stdout(text)
      return
    }
    // An emoji, a flag, or a CRLF split across two deltas is still one character to the
    // terminal, so the last grapheme waits for the next delta unless it ends the line.
    const graphemes = [...GRAPHEME_SEGMENTER.segment(`${this.heldGrapheme}${text}`)].map(
      (part) => part.segment,
    )
    const last = graphemes.at(-1) ?? ''
    this.heldGrapheme = last.endsWith('\n') ? '' : last
    const complete = this.heldGrapheme === '' ? graphemes : graphemes.slice(0, -1)
    if (complete.length > 0) this.stdout(sanitizeTerminalText(complete.join('')))
  }

  /** Machine output that is already safely encoded, such as JSON lines. */
  stdout(text: string) {
    this.enqueue(async () => {
      if (this.stdoutFailed) return
      try {
        await this.sinks.writeStdout(text)
      } catch (error) {
        this.stdoutFailed = true
        this.onStdoutFailure(error)
      }
    })
  }

  stderr(text: string) {
    this.enqueue(() => {
      try {
        this.sinks.writeStderr(sanitizeTerminalText(text))
      } catch {
        // A closed stderr has nobody left to report to.
      }
    })
  }

  flushed() {
    return this.queue
  }
}

/** Wait for `operation`, but no longer than `timeoutMs`; its failure is ignored. */
export async function withTimeout(operation: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    operation.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    }),
  ])
  clearTimeout(timer)
}
