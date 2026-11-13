/**
 * A read-only LevelDB reader, enough to read the database Chromium keeps under
 * `<userData>/session-data/Local Storage/leveldb` once Electron has quit: the live table files the
 * MANIFEST names plus the write-ahead logs it has not compacted yet, resolved by sequence number.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import {
  Cursor,
  type InternalRecord,
  LevelDbError,
  readLogRecords,
  readTableRecords,
  readWriteBatch,
} from './leveldb-records'

const EDIT_COMPARATOR = 1
const EDIT_LOG_NUMBER = 2
const EDIT_NEXT_FILE = 3
const EDIT_LAST_SEQUENCE = 4
const EDIT_COMPACT_POINTER = 5
const EDIT_DELETED_FILE = 6
const EDIT_NEW_FILE = 7
const EDIT_PREV_LOG_NUMBER = 9
const FILE_NUMBER_PATTERN = /^(\d+)\.(log|ldb|sst)$/u

interface LevelDbEntry {
  readonly key: Buffer
  readonly value: Buffer
}

interface ManifestState {
  logNumber: number
  prevLogNumber: number
  readonly liveTables: Set<number>
}

function applyEdit(state: ManifestState, cursor: Cursor, tag: number) {
  match(tag)
    .with(EDIT_COMPARATOR, () => cursor.lengthPrefixed())
    .with(EDIT_LOG_NUMBER, () => {
      state.logNumber = cursor.varint()
    })
    .with(EDIT_PREV_LOG_NUMBER, () => {
      state.prevLogNumber = cursor.varint()
    })
    .with(EDIT_NEXT_FILE, EDIT_LAST_SEQUENCE, () => cursor.varint())
    .with(EDIT_COMPACT_POINTER, () => {
      cursor.varint()
      cursor.lengthPrefixed()
    })
    .with(EDIT_DELETED_FILE, () => {
      cursor.varint()
      state.liveTables.delete(cursor.varint())
    })
    .with(EDIT_NEW_FILE, () => {
      cursor.varint()
      state.liveTables.add(cursor.varint())
      cursor.varint()
      cursor.lengthPrefixed()
      cursor.lengthPrefixed()
    })
    .otherwise(() => {
      throw new LevelDbError(`LevelDB MANIFEST has an unknown edit tag ${String(tag)}.`)
    })
}

/** Applies the MANIFEST's version edits: which table files are live and which logs are current. */
export function readManifest(manifest: Buffer) {
  const state: ManifestState = { logNumber: 0, prevLogNumber: 0, liveTables: new Set() }
  for (const edit of readLogRecords(manifest)) {
    const cursor = new Cursor(edit)
    while (!cursor.done) applyEdit(state, cursor, cursor.varint())
  }
  return state
}

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readManifestState(directory: string) {
  let current: string
  try {
    current = (await readFile(path.join(directory, 'CURRENT'), 'utf8')).trim()
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  if (!/^MANIFEST-\d+$/u.test(current)) throw new LevelDbError('LevelDB CURRENT is invalid.')
  return readManifest(await readFile(path.join(directory, current)))
}

/**
 * Every live key and value, in key order. A missing directory or one without a CURRENT file is an
 * empty database; a database whose live files cannot be read throws, so the caller keeps its own
 * state untouched and can retry.
 */
export async function readLevelDb(directory: string) {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const manifest = await readManifestState(directory)
  if (!manifest) return []
  const records: InternalRecord[] = []
  for (const name of names) {
    const parsed = FILE_NUMBER_PATTERN.exec(name)
    if (!parsed) continue
    const [, numberText, extension] = parsed
    const number = Number(numberText)
    const filePath = path.join(directory, name)
    if (extension !== 'log') {
      if (manifest.liveTables.has(number)) {
        records.push(...readTableRecords(await readFile(filePath)))
      }
      continue
    }
    // Logs older than the MANIFEST's log number are already in tables (or obsolete).
    if (number < manifest.logNumber && number !== manifest.prevLogNumber) continue
    for (const batch of readLogRecords(await readFile(filePath))) readWriteBatch(batch, records)
  }
  const newest = new Map<string, InternalRecord>()
  for (const record of records) {
    const id = record.key.toString('latin1')
    const known = newest.get(id)
    if (!known || record.sequence > known.sequence) newest.set(id, record)
  }
  const entries: LevelDbEntry[] = [...newest.values()]
    .filter((record): record is InternalRecord & { value: Buffer } => record.value !== null)
    .sort((left, right) => Buffer.compare(left.key, right.key))
    .map(({ key, value }) => ({ key, value }))
  return entries
}
