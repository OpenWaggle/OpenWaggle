import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { legacyDatabaseFileState, legacyDatabaseFileStateSync } from '../legacy-database-file'

let directory = ''
let database = ''

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ow-legacy-db-'))
  database = path.join(directory, 'openwaggle.db')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** The boot shim judges the file synchronously; the Host's cutover asynchronously. Both agree. */
async function bothStates() {
  return [await legacyDatabaseFileState(database), legacyDatabaseFileStateSync(database)]
}

describe('the legacy database file state', () => {
  it('is absent without the file', async () => {
    expect(await bothStates()).toEqual(['absent', 'absent'])
  })

  it('is empty for a 0-byte file with no WAL frames (#357)', async () => {
    await writeFile(database, '')
    expect(await bothStates()).toEqual(['empty', 'empty'])
    await writeFile(`${database}-wal`, '')
    expect(await bothStates()).toEqual(['empty', 'empty'])
  })

  it('is present for a 0-byte file whose WAL holds frames, or a file with content', async () => {
    await writeFile(database, '')
    await writeFile(`${database}-wal`, 'wal frames')
    expect(await bothStates()).toEqual(['present', 'present'])
    await writeFile(database, 'SQLite format 3')
    expect(await bothStates()).toEqual(['present', 'present'])
  })
})
