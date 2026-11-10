import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { temporaryTestDirectory } from '../../test-support/temporary-test-directory'
import { readElectronLocalStorage } from '../chromium-local-storage'
import { readLevelDb } from '../leveldb'

// Written by Electron 43.2.0 (the shipped version) in three launches: values and a bulk of keys,
// then deletions and an overwrite, then more edits that stay in the write-ahead log. The table
// file holds snappy-compressed blocks.
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'electron-43-local-storage')

async function expected() {
  const parsed: unknown = JSON.parse(await readFile(path.join(FIXTURE, 'expected.json'), 'utf8'))
  return parsed
}

async function fixtureCopy() {
  const directory = await temporaryTestDirectory('ow-leveldb-')
  await cp(FIXTURE, directory, { recursive: true })
  await rm(path.join(directory, 'expected.json'))
  return directory
}

describe('readElectronLocalStorage', () => {
  it('returns exactly what the Electron renderer last saw for its origin', async () => {
    const snapshot = await readElectronLocalStorage({
      levelDbDirectory: FIXTURE,
      origin: 'openwaggle://app',
    })
    expect(snapshot.entries).toEqual(await expected())
    expect(snapshot.undecodable).toBe(0)
  })

  it('decodes UTF-16 and Latin-1 keys and values', async () => {
    const { entries } = await readElectronLocalStorage({
      levelDbDirectory: FIXTURE,
      origin: 'openwaggle://app',
    })
    expect(entries['utf16-key-✓']).toBe('значение 値 😀')
    expect(entries['latin1-key-é']).toBe('café crème')
    expect(entries['empty-value']).toBe('')
  })

  it('leaves other origins out', async () => {
    const { entries } = await readElectronLocalStorage({
      levelDbDirectory: FIXTURE,
      origin: 'http://localhost:5173',
    })
    expect(entries).toEqual({})
  })

  it('treats a missing database as empty', async () => {
    const directory = await temporaryTestDirectory('ow-leveldb-missing-')
    await expect(readLevelDb(path.join(directory, 'leveldb'))).resolves.toEqual([])
  })

  it('ignores a torn record at the end of the write-ahead log', async () => {
    const directory = await fixtureCopy()
    const log = path.join(directory, '000004.log')
    const original = await readFile(log)
    // A crash mid-write: the header promises more bytes than the file has.
    await writeFile(log, Buffer.concat([original, Uint8Array.of(0, 0, 0, 0, 0xff, 0x00, 1, 9, 9)]))
    const { entries } = await readElectronLocalStorage({
      levelDbDirectory: directory,
      origin: 'openwaggle://app',
    })
    expect(entries).toEqual(await expected())
  })

  it('drops a log record whose checksum does not match', async () => {
    const directory = await fixtureCopy()
    const log = path.join(directory, '000004.log')
    const corrupted = Buffer.from(await readFile(log))
    corrupted[corrupted.length - 1] = (corrupted.at(-1) ?? 0) ^ 0xff
    await writeFile(log, corrupted)
    const { entries } = await readElectronLocalStorage({
      levelDbDirectory: directory,
      origin: 'openwaggle://app',
    })
    // The last batch (phase three) is gone; everything before it survives.
    expect(entries['phase-three-key']).toBeUndefined()
    expect(entries['to-be-overwritten']).toBe('new value')
  })

  it('fails on a corrupt table instead of returning partial data', async () => {
    const directory = await fixtureCopy()
    const table = path.join(directory, '000003.ldb')
    const corrupted = Buffer.from(await readFile(table))
    corrupted[10] = (corrupted[10] ?? 0) ^ 0xff
    await writeFile(table, corrupted)
    await expect(
      readElectronLocalStorage({ levelDbDirectory: directory, origin: 'openwaggle://app' }),
    ).rejects.toThrow(/checksum/u)
  })
})
