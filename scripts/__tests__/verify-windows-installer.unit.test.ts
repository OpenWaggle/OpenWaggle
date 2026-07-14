import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { verifyWindowsInstaller } from '../verify-windows-installer'

describe('Windows installer verification', () => {
  it('installs silently into an isolated directory and verifies the exact executable', async () => {
    const runInstaller = vi.fn(async () => 0)
    const verifyPath = vi.fn(async () => undefined)

    await verifyWindowsInstaller(
      {
        installerPath: 'D:\\artifacts\\openwaggle.exe',
        installDirectory: 'D:\\temp\\openwaggle-install',
      },
      { runInstaller, verifyPath },
    )

    expect(runInstaller).toHaveBeenCalledWith('D:\\artifacts\\openwaggle.exe', [
      '/S',
      '/D=D:\\temp\\openwaggle-install',
    ])
    expect(verifyPath).toHaveBeenNthCalledWith(1, 'D:\\artifacts\\openwaggle.exe')
    expect(verifyPath).toHaveBeenNthCalledWith(
      2,
      join('D:\\temp\\openwaggle-install', 'OpenWaggle.exe'),
    )
  })

  it('rejects a nonzero installer exit code before checking the executable', async () => {
    const verifyPath = vi.fn(async () => undefined)

    await expect(
      verifyWindowsInstaller(
        { installerPath: 'installer.exe', installDirectory: 'install' },
        { runInstaller: async () => 1, verifyPath },
      ),
    ).rejects.toThrow('Windows installer exited with code 1')

    expect(verifyPath).toHaveBeenCalledTimes(1)
  })
})
