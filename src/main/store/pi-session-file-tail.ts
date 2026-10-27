import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

/**
 * Where the entries a Session's projection was read from end in its Pi file, and enough of the
 * bytes before that point to tell the file only grew since (D6, ADR 0051).
 *
 * Pi appends one JSON line per entry and never edits a line in place, so while the file only
 * grows, everything before `offset` is what the projection was read from. `pi --resume`
 * upgrading an older format, a Session's entry-id repair (ADR 0049) and a rewrite by another
 * program all replace the file's lines: the header (in the first bytes) or the last projected
 * line (which ends at `offset`) then differ, or the file is shorter, and the projection is read
 * again from the whole file, as before.
 */
export interface PiSessionFileTail {
  /** The byte just after the newline ending the last projected entry. */
  readonly offset: number
  /** Where the last projected entry's line starts. */
  readonly lineStart: number
  /** sha256 of the file's first bytes and of the last projected entry's line. */
  readonly digest: string
  /** The Pi id of the last projected entry, read from its line. */
  readonly lastEntryId: string
}

/** The bytes of the header end of the file covered by the digest. */
const HEAD_BYTES = 64 * 1024
/** A last line longer than this is not looked for; the next projection reads the whole file. */
const MAX_LAST_LINE_BYTES = 16 * 1024 * 1024
const BACKWARD_READ_BYTES = 64 * 1024
const NEWLINE = 0x0a

function digestOf(head: Buffer, lastLine: Buffer) {
  return createHash('sha256')
    .update(String(head.length))
    .update(':')
    .update(head)
    .update(lastLine)
    .digest('base64')
}

function readRange(descriptor: number, start: number, end: number) {
  const buffer = Buffer.alloc(Math.max(0, end - start))
  let read = 0
  while (read < buffer.length) {
    const bytes = readSync(descriptor, buffer, read, buffer.length - read, start + read)
    if (bytes === 0) break
    read += bytes
  }
  return read === buffer.length ? buffer : buffer.subarray(0, read)
}

function entryIdOfLine(line: Buffer) {
  try {
    const entry: unknown = JSON.parse(line.toString('utf8'))
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) return null
    if ('type' in entry && entry.type === 'session') return null
    return typeof entry.id === 'string' ? entry.id : null
  } catch {
    return null
  }
}

/** Where the line that ends at `offset` (a newline at `offset - 1`) starts, or null. */
function lineStartBefore(descriptor: number, offset: number) {
  let end = offset - 1
  while (end > 0 && offset - end <= MAX_LAST_LINE_BYTES) {
    const start = Math.max(0, end - BACKWARD_READ_BYTES)
    const chunk = readRange(descriptor, start, end)
    const newline = chunk.lastIndexOf(NEWLINE)
    if (newline >= 0) return start + newline + 1
    end = start
  }
  return end === 0 ? 0 : null
}

function tailEndingAt(descriptor: number, offset: number): PiSessionFileTail | null {
  if (offset <= 0) return null
  if (readRange(descriptor, offset - 1, offset)[0] !== NEWLINE) return null
  const lineStart = lineStartBefore(descriptor, offset)
  if (lineStart === null) return null
  const lastLine = readRange(descriptor, lineStart, offset - 1)
  const lastEntryId = entryIdOfLine(lastLine)
  if (lastEntryId === null) return null
  const head = readRange(descriptor, 0, Math.min(HEAD_BYTES, lineStart))
  return { offset, lineStart, digest: digestOf(head, lastLine), lastEntryId }
}

function withFile<A>(file: string, read: (descriptor: number) => A): A | null {
  let descriptor: number | undefined
  try {
    descriptor = openSync(file, 'r')
    return read(descriptor)
  } catch {
    // A missing or unreadable file has no tail; the next projection reads it whole.
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/**
 * The tail of the file as it is now: its last line, when that is a complete Pi entry. Null when
 * the file ends in a partial line (a writer is still appending) or its last line is not an entry.
 */
export function readPiSessionFileTail(file: string) {
  return withFile(file, (descriptor) => tailEndingAt(descriptor, fstatSync(descriptor).size))
}

/** The tail of the first `size` bytes of a file's content, as `readPiSessionFileTail` reads it. */
export function piSessionFileTailOf(content: Buffer): PiSessionFileTail | null {
  const offset = content.length
  if (offset === 0 || content[offset - 1] !== NEWLINE) return null
  const lastLineEnd = offset - 1
  const newline = lastLineEnd > 0 ? content.lastIndexOf(NEWLINE, lastLineEnd - 1) : -1
  const lineStart = newline < 0 ? 0 : newline + 1
  if (offset - lineStart > MAX_LAST_LINE_BYTES) return null
  const lastLine = content.subarray(lineStart, offset - 1)
  const lastEntryId = entryIdOfLine(lastLine)
  if (lastEntryId === null) return null
  const head = content.subarray(0, Math.min(HEAD_BYTES, lineStart))
  return { offset, lineStart, digest: digestOf(head, lastLine), lastEntryId }
}

/**
 * Whether the file still holds the tail's bytes where they were: it is at least as long, and its
 * first bytes and the tail's last line are unchanged. Only then is it a file that grew since.
 */
export function piSessionFileStillHasTail(file: string, tail: PiSessionFileTail) {
  return (
    withFile(file, (descriptor) => {
      if (fstatSync(descriptor).size < tail.offset) return false
      const lastLine = readRange(descriptor, tail.lineStart, tail.offset - 1)
      const head = readRange(descriptor, 0, Math.min(HEAD_BYTES, tail.lineStart))
      return (
        readRange(descriptor, tail.offset - 1, tail.offset)[0] === NEWLINE &&
        digestOf(head, lastLine) === tail.digest
      )
    }) === true
  )
}

/** The bytes appended after the tail, up to `end`. */
export function readPiSessionFileAfterTail(file: string, tail: PiSessionFileTail, end: number) {
  return withFile(file, (descriptor) => readRange(descriptor, tail.offset, end))
}

/** `piSessionFileStillHasTail` for content already read, as a refresh reads the whole file. */
export function piSessionFileContentHasTail(content: Buffer, tail: PiSessionFileTail) {
  if (content.length < tail.offset || content[tail.offset - 1] !== NEWLINE) return false
  const lastLine = content.subarray(tail.lineStart, tail.offset - 1)
  const head = content.subarray(0, Math.min(HEAD_BYTES, tail.lineStart))
  return digestOf(head, lastLine) === tail.digest
}
