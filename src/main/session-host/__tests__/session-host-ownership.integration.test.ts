import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireSessionHostOwnership, type SessionHostOwnership } from '../session-host-ownership'

describe('Session Host ownership', () => {
  let temporaryRoot = ''
  const ownerships: SessionHostOwnership[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-ownership-'))
  })

  afterEach(async () => {
    for (const ownership of ownerships.splice(0)) await ownership.release()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('permits one owner, rejects a second owner, and transfers only after explicit release', async () => {
    const targetPath = path.join(temporaryRoot, 'session-host.sqlite')
    const first = await acquireSessionHostOwnership(targetPath)
    ownerships.push(first)

    await expect(acquireSessionHostOwnership(targetPath)).rejects.toMatchObject({ code: 'ELOCKED' })
    await first.release()

    const second = await acquireSessionHostOwnership(targetPath)
    ownerships.push(second)
    await expect(second.release()).resolves.toBeUndefined()
    await expect(second.release()).resolves.toBeUndefined()
  })

  it('does not mistake a successor acquired during release for the previous owner', async () => {
    const targetPath = path.join(temporaryRoot, 'handoff.sqlite')
    const first = await acquireSessionHostOwnership(targetPath)
    ownerships.push(first)

    const releasing = first.release()
    const successor = acquireSessionHostOwnership(targetPath)
    const [, second] = await Promise.all([releasing, successor])
    ownerships.push(second)

    await expect(first.release()).resolves.toBeUndefined()
    await expect(second.release()).resolves.toBeUndefined()
  })
})
