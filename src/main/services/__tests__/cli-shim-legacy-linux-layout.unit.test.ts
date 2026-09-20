import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { managedCliShimContent } from '../cli-shim-content'
import { createCliShimService } from '../cli-shim-service'

describe('legacy Linux CLI layout', () => {
  let homeDirectory: string

  beforeEach(async () => {
    homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-cli-'))
  })

  afterEach(async () => {
    await fs.rm(homeDirectory, { recursive: true, force: true })
  })

  function layout() {
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    const appImagePath = path.join(
      homeDirectory,
      '.local',
      'lib',
      'openwaggle',
      'OpenWaggle.AppImage',
    )
    return { commandPath, appImagePath }
  }

  it('requires an installer restart instead of moving the running AppImage', async () => {
    const { commandPath, appImagePath } = layout()
    await fs.mkdir(path.dirname(commandPath), { recursive: true })
    const appImage = Buffer.from('legacy-appimage')
    await fs.writeFile(commandPath, appImage)
    const cli = createCliShimService({
      platform: 'linux',
      homeDirectory,
      executablePath: commandPath,
      legacyLinuxAppImagePath: commandPath,
      environmentPath: path.dirname(commandPath),
    })

    await expect(cli.status()).resolves.toMatchObject({
      state: 'outdated',
      detail: expect.stringContaining('installer'),
    })
    await expect(cli.install()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('restart'),
      status: { state: 'outdated' },
    })
    await expect(fs.readFile(commandPath)).resolves.toEqual(appImage)
    await expect(fs.stat(appImagePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps installer migration intact until the legacy process restarts', async () => {
    const { commandPath, appImagePath } = layout()
    await fs.mkdir(path.dirname(commandPath), { recursive: true })
    await fs.writeFile(commandPath, 'legacy AppImage')
    const legacyProcess = createCliShimService({
      platform: 'linux',
      homeDirectory,
      executablePath: commandPath,
      legacyLinuxAppImagePath: commandPath,
      environmentPath: path.dirname(commandPath),
    })
    const installerShim = managedCliShimContent({
      platform: 'linux',
      homeDirectory,
      executablePath: appImagePath,
      environmentPath: path.dirname(commandPath),
    })

    await fs.writeFile(commandPath, installerShim)

    await expect(legacyProcess.status()).resolves.toMatchObject({
      state: 'outdated',
      detail: expect.stringContaining('restart'),
    })
    await expect(legacyProcess.install()).resolves.toMatchObject({ ok: false })
    await expect(fs.readFile(commandPath, 'utf8')).resolves.toBe(installerShim)
  })
})
