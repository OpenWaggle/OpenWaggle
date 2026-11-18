import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyInstallerUpdateChannelIntent,
  INSTALLER_UPDATE_CHANNEL_INTENT_FILENAME,
} from '../installer-update-channel-intent'

const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-channel-intent-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })))
})

describe('installer update channel intent', () => {
  it('applies and removes a valid installer preference only after persistence succeeds', async () => {
    const root = await temporaryRoot()
    const intentPath = path.join(root, INSTALLER_UPDATE_CHANNEL_INTENT_FILENAME)
    await fs.writeFile(intentPath, 'alpha\n')
    const persist = vi.fn(async () => undefined)

    await expect(applyInstallerUpdateChannelIntent(root, persist)).resolves.toBe('alpha')

    expect(persist).toHaveBeenCalledWith('alpha')
    await expect(fs.access(intentPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains a valid preference when durable persistence fails', async () => {
    const root = await temporaryRoot()
    const intentPath = path.join(root, INSTALLER_UPDATE_CHANNEL_INTENT_FILENAME)
    await fs.writeFile(intentPath, 'beta\n')

    await expect(
      applyInstallerUpdateChannelIntent(root, async () => {
        throw new Error('database unavailable')
      }),
    ).rejects.toThrow('database unavailable')

    await expect(fs.readFile(intentPath, 'utf8')).resolves.toBe('beta\n')
  })

  it('discards malformed local intent without applying it', async () => {
    const root = await temporaryRoot()
    const intentPath = path.join(root, INSTALLER_UPDATE_CHANNEL_INTENT_FILENAME)
    await fs.writeFile(intentPath, 'nightly\n')
    const persist = vi.fn(async () => undefined)

    await expect(applyInstallerUpdateChannelIntent(root, persist)).resolves.toBeNull()

    expect(persist).not.toHaveBeenCalled()
    await expect(fs.access(intentPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
