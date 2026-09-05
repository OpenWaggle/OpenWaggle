import { TERMINAL } from '@shared/constants/resource-limits'

const CHAR_CODE_LINE_FEED = 10

/**
 * In-memory scrollback for one terminal: the authoritative replay text kept
 * hot in the main process, capped at MAX_SCROLLBACK_LINES lines (ADR 0030).
 */
export interface TerminalScrollback {
  append(text: string): void
  reset(): void
  toString(): string
  readonly lineCount: number
}

export function createTerminalScrollback(
  maxLines: number = TERMINAL.MAX_SCROLLBACK_LINES,
): TerminalScrollback {
  let text = ''
  let lines = 0

  const countLines = (chunk: string) => {
    let count = 0
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk.charCodeAt(index) === CHAR_CODE_LINE_FEED) count += 1
    }
    return count
  }

  return {
    append(chunk) {
      if (chunk.length === 0) return
      text += chunk
      lines += countLines(chunk)
      if (lines <= maxLines) return

      // Trim to the newest maxLines lines; keep at most one partial leading line.
      let cut = 0
      let remaining = lines - maxLines
      while (remaining > 0 && cut < text.length) {
        if (text.charCodeAt(cut) === CHAR_CODE_LINE_FEED) remaining -= 1
        cut += 1
      }
      text = text.slice(cut)
      lines = maxLines
    },
    reset() {
      text = ''
      lines = 0
    },
    toString() {
      return text
    },
    get lineCount() {
      return lines
    },
  }
}
