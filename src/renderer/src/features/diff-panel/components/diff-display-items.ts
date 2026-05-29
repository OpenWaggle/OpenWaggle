import { DOUBLE_FACTOR } from '@shared/constants/math'

const PARSE_INT_ARG_2 = 10
const FLUSH_CONTEXT_VALUE_6 = 6
const SLICE_ARG_2 = 3
const SLICE_ARG_1 = 3
const SLICE_ARG_2_NEGATIVE_3 = -3
const SLICE_ARG_1_NEGATIVE_3 = -3

export interface ParsedLine {
  type: 'add' | 'remove' | 'context'
  content: string
  lineNumber: number | null
}

export type DisplayItem =
  | { kind: 'line'; line: ParsedLine; index: number }
  | { kind: 'collapsed'; lines: ParsedLine[]; key: string }

interface DiffCursor {
  oldLine: number
  newLine: number
  headerSeen: boolean
}

function shouldSkipDiffMetadataLine(line: string) {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('---') ||
    line.startsWith('+++') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file') ||
    line.startsWith('similarity') ||
    line.startsWith('rename')
  )
}

function readHunkHeader(line: string, cursor: DiffCursor) {
  const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!hunkMatch) {
    return false
  }

  cursor.oldLine = Number.parseInt(hunkMatch[1] ?? '1', PARSE_INT_ARG_2)
  cursor.newLine = Number.parseInt(hunkMatch[DOUBLE_FACTOR] ?? '1', PARSE_INT_ARG_2)
  cursor.headerSeen = true
  return true
}

function parseDiffContentLine(line: string, cursor: DiffCursor): ParsedLine | null {
  if (!cursor.headerSeen) return null

  if (line.startsWith('+')) {
    const parsed: ParsedLine = { type: 'add', content: line.slice(1), lineNumber: cursor.newLine }
    cursor.newLine += 1
    return parsed
  }

  if (line.startsWith('-')) {
    const parsed: ParsedLine = {
      type: 'remove',
      content: line.slice(1),
      lineNumber: cursor.oldLine,
    }
    cursor.oldLine += 1
    return parsed
  }

  if (!line.startsWith(' ') && line !== '') return null

  const parsed: ParsedLine = {
    type: 'context',
    content: line.startsWith(' ') ? line.slice(1) : '',
    lineNumber: cursor.newLine,
  }
  cursor.oldLine += 1
  cursor.newLine += 1
  return parsed
}

function parseRawDiff(diff: string) {
  const displayLines: ParsedLine[] = []
  const cursor = { oldLine: 0, newLine: 0, headerSeen: false }

  for (const line of diff.split('\n')) {
    if (shouldSkipDiffMetadataLine(line) || readHunkHeader(line, cursor)) continue
    const parsedLine = parseDiffContentLine(line, cursor)
    if (parsedLine) displayLines.push(parsedLine)
  }
  return displayLines
}

export function buildDisplayItems(diff: string): DisplayItem[] {
  const displayLines = parseRawDiff(diff)
  const items: DisplayItem[] = []
  let contextBuffer: ParsedLine[] = []
  let lineIdx = 0

  function flushContext() {
    if (contextBuffer.length === 0) return
    if (contextBuffer.length <= FLUSH_CONTEXT_VALUE_6) {
      for (const line of contextBuffer) {
        items.push({ kind: 'line', line, index: lineIdx++ })
      }
    } else {
      for (const line of contextBuffer.slice(0, SLICE_ARG_2)) {
        items.push({ kind: 'line', line, index: lineIdx++ })
      }
      const key = `collapsed-${lineIdx}`
      items.push({
        kind: 'collapsed',
        lines: contextBuffer.slice(SLICE_ARG_1, SLICE_ARG_2_NEGATIVE_3),
        key,
      })
      lineIdx += contextBuffer.length - FLUSH_CONTEXT_VALUE_6
      for (const line of contextBuffer.slice(SLICE_ARG_1_NEGATIVE_3)) {
        items.push({ kind: 'line', line, index: lineIdx++ })
      }
    }
    contextBuffer = []
  }

  for (const line of displayLines) {
    if (line.type === 'context') {
      contextBuffer.push(line)
      continue
    }
    flushContext()
    items.push({ kind: 'line', line, index: lineIdx++ })
  }

  flushContext()
  return items
}
