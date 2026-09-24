import type { HistoryFiles, TerminalHistoryFiles } from './terminal-history-files'

type PendingCursor =
  | { kind: 'append'; endOffset: number; previousBytes: number; text: string }
  | { kind: 'replace'; endOffset: number; text: string }

const validOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function parseCursor(raw: string): number | PendingCursor {
  if (/^\d+$/.test(raw)) {
    const endOffset = Number(raw)
    if (validOffset(endOffset)) return endOffset
  }
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid terminal history cursor.')
  const readField = (name: string): unknown => Reflect.get(value, name)
  const kind = readField('kind')
  const endOffset = readField('endOffset')
  const text = readField('text')
  if (!validOffset(endOffset) || typeof text !== 'string')
    throw new Error('Invalid terminal history cursor.')
  if (kind === 'replace') return { kind, endOffset, text }
  const previousBytes = readField('previousBytes')
  if (kind === 'append' && validOffset(previousBytes))
    return { kind, endOffset, previousBytes, text }
  throw new Error('Invalid terminal history cursor.')
}

export async function recoverHistoryCursor(files: TerminalHistoryFiles, entry: HistoryFiles) {
  const rawCursor = await files.readIfPresent(entry.cursorFile)
  if (rawCursor === null) return { endOffset: null, recovered: false }
  const cursor = parseCursor(rawCursor)
  if (typeof cursor === 'number') return { endOffset: cursor, recovered: false }

  let desired = cursor.text
  if (cursor.kind === 'append') {
    const current = (await files.readIfPresent(entry.logFile)) ?? ''
    const prefix = Buffer.from(current).subarray(0, cursor.previousBytes)
    if (prefix.byteLength !== cursor.previousBytes)
      throw new Error('Terminal history log is shorter than its cursor journal.')
    desired = prefix.toString('utf8') + cursor.text
    if (Buffer.byteLength(desired) !== cursor.previousBytes + Buffer.byteLength(cursor.text))
      throw new Error('Terminal history log has an invalid cursor journal prefix.')
    if (current !== desired) await files.writePrivateAtomically(entry.logFile, desired)
  } else {
    const current = await files.readIfPresent(entry.logFile)
    if (current !== desired) await files.writePrivateAtomically(entry.logFile, desired)
  }
  await files.writePrivateAtomically(entry.cursorFile, String(cursor.endOffset))
  return { endOffset: cursor.endOffset, recovered: true }
}

export async function appendWithCursor(
  files: TerminalHistoryFiles,
  entry: HistoryFiles,
  previousBytes: number,
  text: string,
  endOffset: number,
) {
  const pending: PendingCursor = { kind: 'append', endOffset, previousBytes, text }
  await files.writePrivateAtomically(entry.cursorFile, JSON.stringify(pending))
  await files.appendPrivate(entry.logFile, text)
  await files.writePrivateAtomically(entry.cursorFile, String(endOffset))
}

export async function replaceWithCursor(
  files: TerminalHistoryFiles,
  entry: HistoryFiles,
  text: string,
  endOffset: number,
) {
  const pending: PendingCursor = { kind: 'replace', endOffset, text }
  await files.writePrivateAtomically(entry.cursorFile, JSON.stringify(pending))
  await files.writePrivateAtomically(entry.logFile, text)
  await files.writePrivateAtomically(entry.cursorFile, String(endOffset))
}
