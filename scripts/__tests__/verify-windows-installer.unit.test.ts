import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  reportWindowsInstallerVerificationError,
  verifyWindowsInstaller,
  windowsPathContains,
} from '../verify-windows-installer'

describe('Windows installer verification', () => {
  it('separates the installed CLI arguments from Electron runtime arguments', async () => {
    const installer = await readFile('build/installer.nsh', 'utf8')

    // Colon-bearing capabilities otherwise trip Electron's native Windows URL guard
    // before the application can route the command or report an error.
    expect(installer).toContain(String.raw`FileWrite $0 '@"%~dp0OpenWaggle.exe" -- %*$\r$\n'`)
  })

  it('executes the installed CLI by fresh-shell command name and removes PATH on uninstall', async () => {
    const runInstaller = vi.fn(async () => 0)
    const runUninstaller = vi.fn(async () => 0)
    const verifyPath = vi.fn(async () => undefined)
    const verifyCli = vi.fn(async () => undefined)
    const readUserPath = vi
      .fn()
      .mockResolvedValueOnce('C:\\Windows')
      .mockResolvedValueOnce('C:\\Windows;D:\\temp\\openwaggle-install')
      .mockResolvedValueOnce('C:\\Windows')
    const resolveCommand = vi.fn(async () => 'D:\\temp\\openwaggle-install\\openwaggle.cmd')

    await verifyWindowsInstaller(
      {
        installerPath: 'D:\\artifacts\\openwaggle.exe',
        installDirectory: 'D:\\temp\\openwaggle-install',
      },
      { readUserPath, resolveCommand, runInstaller, runUninstaller, verifyCli, verifyPath },
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
    expect(verifyPath).toHaveBeenNthCalledWith(
      3,
      join('D:\\temp\\openwaggle-install', 'openwaggle.cmd'),
    )
    expect(verifyPath).toHaveBeenNthCalledWith(
      4,
      join('D:\\temp\\openwaggle-install', 'Uninstall OpenWaggle.exe'),
    )
    expect(resolveCommand).toHaveBeenCalledWith('openwaggle', expect.objectContaining({
      PATH: expect.stringContaining('D:\\temp\\openwaggle-install'),
      PATHEXT: expect.stringContaining('.CMD'),
    }))
    expect(verifyCli).toHaveBeenCalledWith(
      'openwaggle',
      expect.objectContaining({
        PATH: expect.stringContaining('D:\\temp\\openwaggle-install'),
      }),
      { timeoutMs: 120_000 },
    )
    expect(runUninstaller).toHaveBeenCalledWith(
      join('D:\\temp\\openwaggle-install', 'Uninstall OpenWaggle.exe'),
      ['/S'],
    )
  })

  it('rejects a nonzero installer exit code before checking the executable', async () => {
    const verifyPath = vi.fn(async () => undefined)

    await expect(
      verifyWindowsInstaller(
        { installerPath: 'installer.exe', installDirectory: 'install' },
        {
          readUserPath: async () => '',
          runInstaller: async () => 1,
          verifyCli: vi.fn(),
          verifyPath,
        },
      ),
    ).rejects.toThrow('Windows installer exited with code 1')

    expect(verifyPath).toHaveBeenCalledTimes(1)
  })

  it('matches Windows PATH entries case-insensitively without prefix collisions', () => {
    expect(windowsPathContains('C:\\Tools;D:\\OpenWaggle\\', 'd:\\openwaggle')).toBe(true)
    expect(windowsPathContains('D:\\OpenWaggle-old', 'D:\\OpenWaggle')).toBe(false)
  })

  it('waits for the detached NSIS uninstaller to remove its PATH entry', async () => {
    const wait = vi.fn(async () => undefined)
    const readUserPath = vi
      .fn()
      .mockResolvedValueOnce('C:\\Windows')
      .mockResolvedValueOnce('C:\\Windows;D:\\temp\\openwaggle-install')
      .mockResolvedValueOnce('C:\\Windows;D:\\temp\\openwaggle-install')
      .mockResolvedValueOnce('C:\\Windows')

    await verifyWindowsInstaller(
      {
        installerPath: 'D:\\artifacts\\openwaggle.exe',
        installDirectory: 'D:\\temp\\openwaggle-install',
      },
      {
        readUserPath,
        resolveCommand: async () => 'D:\\temp\\openwaggle-install\\openwaggle.cmd',
        runInstaller: async () => 0,
        runUninstaller: async () => 0,
        verifyCli: async () => undefined,
        verifyPath: async () => undefined,
        wait,
      },
    )

    expect(wait).toHaveBeenCalledOnce()
  })

  it('reports the complete aggregate instead of hiding nested causes', () => {
    const error = new AggregateError(
      [
        new AggregateError(
          [new Error('Installed OpenWaggle CLI timed out after 30000ms.')],
          'Installed CLI verification failed.',
        ),
        new Error('Windows uninstaller left its CLI directory in the user PATH.'),
      ],
      'Windows installer verification and uninstall both failed.',
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      reportWindowsInstallerVerificationError(error)
      const report = consoleError.mock.calls[0]?.[0]
      expect(report).toContain('Installed OpenWaggle CLI timed out after 30000ms.')
      expect(report).toContain('Windows uninstaller left its CLI directory in the user PATH.')
    } finally {
      consoleError.mockRestore()
    }
  })
})
