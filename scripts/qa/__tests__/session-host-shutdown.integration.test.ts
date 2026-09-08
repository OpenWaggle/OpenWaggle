import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireSessionHostOwnership,
  type SessionHostOwnership,
} from '../../../src/main/session-host/session-host-ownership'
import { prepareQaProfileRemoval } from '../session-host-shutdown'

describe('QA Session Host profile removal', () => {
  let userDataRoot: string | undefined

  afterEach(async () => {
    if (userDataRoot) await fs.rm(userDataRoot, { recursive: true, force: true })
  })

  it('preserves the ownership inode during deletion and after a successor reacquires it', async () => {
    userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-shutdown-'))
    const stateRoot = path.join(userDataRoot, 'session-host')
    const databasePath = path.join(stateRoot, 'session-host.sqlite')
    const unrelatedPath = path.join(userDataRoot, 'renderer-state.json')
    await fs.mkdir(stateRoot, { recursive: true })
    await fs.writeFile(databasePath, 'database fixture')
    await fs.writeFile(unrelatedPath, 'renderer fixture')

    let firstOwnership: SessionHostOwnership | undefined
    let secondOwnership: SessionHostOwnership | undefined
    try {
      firstOwnership = await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
      const ownershipPath = `${databasePath}.ownership.sqlite`
      const ownershipJournalPath = `${ownershipPath}-journal`
      const originalInode = await fs.stat(ownershipPath)
      const originalJournalInode = await fs.stat(ownershipJournalPath)
      const finishProfileRemoval = await prepareQaProfileRemoval(userDataRoot, firstOwnership)

      await expect(fs.access(databasePath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.access(unrelatedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await fs.stat(ownershipJournalPath)).toMatchObject({
        dev: originalJournalInode.dev,
        ino: originalJournalInode.ino,
      })
      await expect(
        acquireSessionHostOwnership(databasePath, { timeoutMs: 0 }),
      ).rejects.toMatchObject({ code: 'ELOCKED' })

      await firstOwnership.release()
      firstOwnership = undefined
      secondOwnership = await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
      await fs.writeFile(databasePath, 'successor database')
      await expect(finishProfileRemoval()).resolves.toBeUndefined()
      expect(await fs.readFile(databasePath, 'utf8')).toBe('successor database')
      expect(await fs.stat(ownershipPath)).toMatchObject({
        dev: originalInode.dev,
        ino: originalInode.ino,
      })
      await expect(
        acquireSessionHostOwnership(databasePath, { timeoutMs: 0 }),
      ).rejects.toMatchObject({ code: 'ELOCKED' })

      await secondOwnership.release()
      secondOwnership = undefined
      await finishProfileRemoval()
      expect(await fs.readFile(databasePath, 'utf8')).toBe('successor database')
      expect(await fs.stat(ownershipPath)).toMatchObject({
        dev: originalInode.dev,
        ino: originalInode.ino,
      })
    } finally {
      await secondOwnership?.release().catch(() => undefined)
      await firstOwnership?.release().catch(() => undefined)
    }
  })

  it('retains only the sanitized ownership skeleton when no successor has started', async () => {
    userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-shutdown-'))
    const stateRoot = path.join(userDataRoot, 'session-host')
    const databasePath = path.join(stateRoot, 'session-host.sqlite')
    const ownership = await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
    try {
      await fs.writeFile(databasePath, 'private transcript fixture')
      await fs.writeFile(path.join(stateRoot, 'local-user.credential'), 'private credential fixture')
      await fs.mkdir(path.join(userDataRoot, 'renderer-cache'))
      await fs.writeFile(path.join(userDataRoot, 'renderer-cache', 'cached-history'), 'private history')

      const finalize = await prepareQaProfileRemoval(userDataRoot, ownership)
      await ownership.release()
      await finalize()

      expect(await fs.readdir(userDataRoot)).toEqual(['session-host'])
      expect(await fs.readdir(stateRoot)).toEqual(['session-host.sqlite.ownership.sqlite'])
    } finally {
      await ownership.release()
    }
  })

  it('preserves only exact ownership SQLite companions, not other profile journals or similar names', async () => {
    userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-shutdown-'))
    const stateRoot = path.join(userDataRoot, 'session-host')
    const databasePath = path.join(stateRoot, 'session-host.sqlite')
    const ownershipName = 'session-host.sqlite.ownership.sqlite'
    const preservedNames = [
      ownershipName,
      `${ownershipName}-journal`,
      `${ownershipName}-wal`,
      `${ownershipName}-shm`,
    ]
    const removedNames = [
      'session-host.sqlite-journal',
      `${ownershipName}-journal.extra`,
      `${ownershipName}-wal.backup`,
      `${ownershipName}.private`,
    ]
    await fs.mkdir(stateRoot, { recursive: true })
    for (const name of [...preservedNames, ...removedNames]) {
      await fs.writeFile(path.join(stateRoot, name), 'fixture')
    }

    const finalize = await prepareQaProfileRemoval(userDataRoot, {
      targetPath: databasePath,
      release: async () => undefined,
    })
    await finalize()

    expect((await fs.readdir(stateRoot)).toSorted()).toEqual(preservedNames.toSorted())
  })
})
