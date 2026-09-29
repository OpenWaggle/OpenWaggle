const ESCAPE = 0x1b
const BELL = 0x07
const DELETE = 0x7f
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const C0_END = 0x1f
const C1_START = 0x80
const C1_END = 0x9f
const CSI_INTRODUCER = 0x5b
const OSC_INTRODUCER = 0x5d
const STRING_TERMINATOR = 0x5c
const CSI_FINAL_START = 0x40
const CSI_FINAL_END = 0x7e
/** An escape byte plus its introducer. */
const ESCAPE_PREFIX_LENGTH = 2

function isFinalCsiByte(code: number) {
  return code >= CSI_FINAL_START && code <= CSI_FINAL_END
}

function skipCsi(text: string, start: number) {
  let index = start
  while (index < text.length && !isFinalCsiByte(text.charCodeAt(index))) index += 1
  return index + 1
}

function skipOsc(text: string, start: number) {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === BELL) return index + 1
    if (code === ESCAPE && text.charCodeAt(index + 1) === STRING_TERMINATOR) {
      return index + ESCAPE_PREFIX_LENGTH
    }
    index += 1
  }
  return index
}

/** Where an escape sequence starting at `start` ends, so all of it can be dropped. */
function skipEscapeSequence(text: string, start: number) {
  const introducer = text.charCodeAt(start + 1)
  if (introducer === CSI_INTRODUCER) return skipCsi(text, start + ESCAPE_PREFIX_LENGTH)
  if (introducer === OSC_INTRODUCER) return skipOsc(text, start + ESCAPE_PREFIX_LENGTH)
  return Math.min(start + ESCAPE_PREFIX_LENGTH, text.length)
}

function isDroppedControl(code: number) {
  if (code === TAB || code === LINE_FEED) return false
  return code <= C0_END || code === DELETE || (code >= C1_START && code <= C1_END)
}

/**
 * Remove terminal control sequences from agent-controlled text. Without this, a tool argument
 * or approval message could move the cursor or rewrite the line a user is about to approve.
 */
export function sanitizeTerminalText(text: string) {
  let result = ''
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === ESCAPE) {
      index = skipEscapeSequence(text, index)
      continue
    }
    if (code === CARRIAGE_RETURN && text.charCodeAt(index + 1) === LINE_FEED) {
      index += 1
      continue
    }
    if (!isDroppedControl(code)) result += text[index]
    index += 1
  }
  return result
}

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

  private enqueue(write: () => Promise<void> | void) {
    this.queue = this.queue.then(write)
  }

  /** Agent reply text. Stops quietly after the reader goes away (for example, `| head`). */
  reply(text: string) {
    this.stdout(this.sinks.stdoutIsTerminal ? sanitizeTerminalText(text) : text)
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
