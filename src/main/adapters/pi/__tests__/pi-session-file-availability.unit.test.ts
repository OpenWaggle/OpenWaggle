import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPiSessionFiles } from '../pi-session-files'

/**
 * A Pi file is deleted only when it is gone from a folder that is there. One out of reach, behind
 * a link to a drive that is not connected or in a folder that cannot be read, is unavailable: a
 * discovered Session's file that is only out of reach must not take the Session with it.
 */

let root = ''
const files = createPiSessionFiles()

async function availability(file: string) {
  return {
    deleted: await Effect.runPromise(files.isDeleted(file)),
    unavailable: await Effect.runPromise(files.unavailability(file)),
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ow-pi-file-availability-'))
})

afterEach(async () => {
  await chmod(path.join(root, 'locked'), 0o700).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
})

describe('A Pi session file', () => {
  it('is deleted when it is gone from its folder', async () => {
    expect(await availability(path.join(root, 'gone.jsonl'))).toEqual({
      deleted: true,
      unavailable: undefined,
    })
  })

  it('is unavailable when its folder is gone', async () => {
    expect(await availability(path.join(root, 'away', 'file.jsonl'))).toEqual({
      deleted: false,
      unavailable: 'folder',
    })
  })

  it('is unavailable, not deleted, behind a link whose target is out of reach', async () => {
    const link = path.join(root, 'linked.jsonl')
    await symlink(path.join(root, 'unmounted', 'file.jsonl'), link)

    expect(await availability(link)).toEqual({ deleted: false, unavailable: 'file' })
  })

  it.skipIf(process.getuid?.() === 0)('is unavailable in a folder it may not read', async () => {
    const locked = path.join(root, 'locked')
    await mkdir(locked)
    await writeFile(path.join(locked, 'file.jsonl'), '')
    await chmod(locked, 0o000)

    expect(await availability(path.join(locked, 'file.jsonl'))).toEqual({
      deleted: false,
      unavailable: 'file',
    })
  })

  it.skipIf(process.getuid?.() === 0)('is unavailable when it may not be read itself', async () => {
    const file = path.join(root, 'unreadable.jsonl')
    await writeFile(file, '')
    await chmod(file, 0o000)

    expect(await availability(file)).toEqual({ deleted: false, unavailable: 'file' })
  })

  it('is neither when it is there', async () => {
    const file = path.join(root, 'here.jsonl')
    await writeFile(file, '')

    expect(await availability(file)).toEqual({ deleted: false, unavailable: undefined })
  })
})
