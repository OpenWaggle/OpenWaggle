import { BYTES_PER_KIBIBYTE, TERMINAL } from '@shared/constants/resource-limits'
import {
  measureTerminalHistoryText,
  retainTerminalHistorySuffix,
  type TerminalHistoryText,
} from './terminal-history-retention'

const CHAR_CODE_LINE_FEED = 10
const SEGMENT_TARGET_BYTES = 64 * BYTES_PER_KIBIBYTE
const HEAD_COMPACTION_THRESHOLD = 128
const HEAD_COMPACTION_RATIO = 2

function trimLeadingLines(segment: TerminalHistoryText, linesToRemove: number) {
  let cut = 0
  let removedLines = 0
  while (cut < segment.text.length && removedLines < linesToRemove) {
    if (segment.text.charCodeAt(cut) === CHAR_CODE_LINE_FEED) removedLines += 1
    cut += 1
  }
  return measureTerminalHistoryText(segment.text.slice(cut))
}

function joinSegments(
  segments: readonly TerminalHistoryText[],
  head: number,
  pendingParts: readonly string[],
) {
  const persisted = segments.slice(head).map((segment) => segment.text)
  return [...persisted, ...pendingParts].join('')
}

/**
 * In-memory scrollback for one terminal: the authoritative replay text kept
 * hot in the main process, capped at MAX_SCROLLBACK_LINES lines (ADR 0030).
 */
export interface TerminalScrollback {
  append(text: string): void
  reset(): void
  toString(): string
  readonly byteCount: number
  readonly lineCount: number
}

export function createTerminalScrollback(
  maxLines: number = TERMINAL.MAX_SCROLLBACK_LINES,
  maxBytes: number = TERMINAL.MAX_SCROLLBACK_BYTES,
): TerminalScrollback {
  const segments: TerminalHistoryText[] = []
  let head = 0
  let pendingParts: string[] = []
  let pendingBytes = 0
  let pendingLines = 0
  let totalBytes = 0
  let totalLines = 0

  const resetState = () => {
    segments.length = 0
    head = 0
    pendingParts = []
    pendingBytes = 0
    pendingLines = 0
    totalBytes = 0
    totalLines = 0
  }

  const flushPendingSegment = () => {
    if (pendingParts.length === 0) return
    segments.push({ text: pendingParts.join(''), bytes: pendingBytes, lines: pendingLines })
    pendingParts = []
    pendingBytes = 0
    pendingLines = 0
  }

  const compactConsumedSegments = () => {
    if (head < HEAD_COMPACTION_THRESHOLD || head * HEAD_COMPACTION_RATIO < segments.length) return
    segments.splice(0, head)
    head = 0
  }

  const discardHead = () => {
    const segment = segments[head]
    if (segment === undefined) return
    totalBytes -= segment.bytes
    totalLines -= segment.lines
    head += 1
  }

  const trimLines = () => {
    let excessLines = totalLines - maxLines
    while (excessLines > 0) {
      const segment = segments[head]
      if (segment === undefined) break
      if (segment.lines < excessLines || segment.lines === 0) {
        excessLines -= segment.lines
        discardHead()
        continue
      }

      const retained = trimLeadingLines(segment, excessLines)
      totalBytes -= segment.bytes - retained.bytes
      totalLines -= segment.lines - retained.lines
      segments[head] = retained
      excessLines = 0
      if (retained.text.length === 0) head += 1
    }
  }

  const trimBytes = () => {
    let excessBytes = totalBytes - maxBytes
    while (excessBytes > 0) {
      const segment = segments[head]
      if (segment === undefined) break
      if (segment.bytes <= excessBytes) {
        excessBytes -= segment.bytes
        discardHead()
        continue
      }

      const retained = retainTerminalHistorySuffix(
        segment.text,
        Number.MAX_SAFE_INTEGER,
        segment.bytes - excessBytes,
      )
      totalBytes -= segment.bytes - retained.bytes
      totalLines -= segment.lines - retained.lines
      segments[head] = retained
      excessBytes = 0
      if (retained.text.length === 0) head += 1
    }
  }

  return {
    append(chunk) {
      if (chunk.length === 0) return
      let measured = measureTerminalHistoryText(chunk)
      if (measured.lines > maxLines || measured.bytes > maxBytes) {
        measured = retainTerminalHistorySuffix(chunk, maxLines, maxBytes)
        resetState()
      }

      if (measured.bytes >= SEGMENT_TARGET_BYTES) {
        flushPendingSegment()
        segments.push(measured)
      } else {
        pendingParts.push(measured.text)
        pendingBytes += measured.bytes
        pendingLines += measured.lines
        if (pendingBytes >= SEGMENT_TARGET_BYTES) flushPendingSegment()
      }
      totalBytes += measured.bytes
      totalLines += measured.lines

      if (totalLines > maxLines || totalBytes > maxBytes) {
        flushPendingSegment()
        trimLines()
        trimBytes()
        compactConsumedSegments()
      }
    },
    reset() {
      resetState()
    },
    toString() {
      return joinSegments(segments, head, pendingParts)
    },
    get byteCount() {
      return totalBytes
    },
    get lineCount() {
      return totalLines
    },
  }
}
