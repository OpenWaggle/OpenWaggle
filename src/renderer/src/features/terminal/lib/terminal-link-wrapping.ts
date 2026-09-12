import type {
  TerminalBufferLineLike,
  TerminalLinkBufferPosition,
  TerminalLinkBufferRange,
  TerminalLinkMatch,
  WrappedTerminalLinkLine,
  WrappedTerminalLinkLineSegment,
} from './terminal-link-types'

const PREVIOUS_BUFFER_INDEX_OFFSET = 2

function columnsByTextIndex(line: TerminalBufferLineLike, text: string) {
  const columns: number[] = []
  if (line.getCell !== undefined && line.length !== undefined) {
    let textIndex = 0
    for (let column = 0; column < line.length && textIndex < text.length; column += 1) {
      const cell = line.getCell(column)
      if (cell === undefined || cell.getWidth() === 0) continue
      const chars = cell.getChars() || ' '
      for (let index = 0; index < chars.length && textIndex + index < text.length; index += 1) {
        columns[textIndex + index] = column + 1
      }
      textIndex += chars.length
    }
  }

  let fallbackColumn = 1
  let cursor = 0
  for (const character of text) {
    const knownColumn = columns[cursor]
    if (knownColumn !== undefined) fallbackColumn = knownColumn
    for (let index = 0; index < character.length; index += 1) {
      columns[cursor + index] ??= fallbackColumn
    }
    cursor += character.length
    fallbackColumn += 1
  }
  return columns
}

/** Reconstructs the logical line that contains a 1-based xterm buffer row. */
export function collectWrappedTerminalLinkLine(
  bufferLineNumber: number,
  getLine: (bufferLineIndex: number) => TerminalBufferLineLike | null | undefined,
): WrappedTerminalLinkLine | null {
  const anchorLine = getLine(bufferLineNumber - 1)
  if (anchorLine === null || anchorLine === undefined) return null

  let firstBufferLineNumber = bufferLineNumber
  let firstLine = anchorLine
  while (firstBufferLineNumber > 1 && firstLine.isWrapped === true) {
    const previous = getLine(firstBufferLineNumber - PREVIOUS_BUFFER_INDEX_OFFSET)
    if (previous === null || previous === undefined) return null
    firstBufferLineNumber -= 1
    firstLine = previous
  }

  const segments: WrappedTerminalLinkLineSegment[] = []
  let startIndex = 0
  let currentBufferLineNumber = firstBufferLineNumber
  while (true) {
    const current = getLine(currentBufferLineNumber - 1)
    if (current === null || current === undefined) break
    const next = getLine(currentBufferLineNumber)
    const continues = next?.isWrapped === true
    const text = current.translateToString(!continues)
    segments.push({
      bufferLineNumber: currentBufferLineNumber,
      text,
      startIndex,
      endIndex: startIndex + text.length,
      columnsByTextIndex: columnsByTextIndex(current, text),
    })
    startIndex += text.length
    if (!continues) break
    currentBufferLineNumber += 1
  }
  return { text: segments.map((segment) => segment.text).join(''), segments }
}

function resolveCharacterPosition(
  segments: readonly WrappedTerminalLinkLineSegment[],
  characterIndex: number,
): TerminalLinkBufferPosition {
  for (const segment of segments) {
    if (characterIndex < segment.endIndex) {
      const localIndex = Math.max(0, characterIndex - segment.startIndex)
      return {
        x: segment.columnsByTextIndex[localIndex] ?? localIndex + 1,
        y: segment.bufferLineNumber,
      }
    }
  }
  const last = segments.at(-1)
  const finalTextIndex = Math.max(0, (last?.text.length ?? 1) - 1)
  return {
    x: last?.columnsByTextIndex[finalTextIndex] ?? finalTextIndex + 1,
    y: last?.bufferLineNumber ?? 1,
  }
}

export function resolveWrappedTerminalLinkRange(
  wrappedLine: WrappedTerminalLinkLine,
  match: Pick<TerminalLinkMatch, 'start' | 'end'>,
): TerminalLinkBufferRange {
  return {
    start: resolveCharacterPosition(wrappedLine.segments, match.start),
    end: resolveCharacterPosition(wrappedLine.segments, Math.max(match.start, match.end - 1)),
  }
}

export function wrappedTerminalLinkRangeIntersectsBufferLine(
  range: TerminalLinkBufferRange,
  bufferLineNumber: number,
) {
  return range.start.y <= bufferLineNumber && bufferLineNumber <= range.end.y
}
