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

  it('holds real canonical ownership through data deletion and fails closed on reacquisition', async () => {
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
      const finishProfileRemoval = await prepareQaProfileRemoval(userDataRoot, firstOwnership)

      await expect(fs.access(databasePath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.access(unrelatedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(
        acquireSessionHostOwnership(databasePath, { timeoutMs: 0 }),
      ).rejects.toMatchObject({ code: 'ELOCKED' })

      await firstOwnership.release()
      firstOwnership = undefined
      secondOwnership = await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
      await expect(finishProfileRemoval()).rejects.toMatchObject({ code: 'ENOTEMPTY' })
      await expect(fs.access(userDataRoot)).resolves.toBeUndefined()

      await secondOwnership.release()
      secondOwnership = undefined
      await finishProfileRemoval()
      await expect(fs.access(userDataRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await secondOwnership?.release().catch(() => undefined)
      await firstOwnership?.release().catch(() => undefined)
    }
  })
})
