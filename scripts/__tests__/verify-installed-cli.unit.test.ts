import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertInstalledCliResponse,
  InstalledCliProcessTreeExitUnprovenError,
  runInstalledCli,
  shouldUseWindowsVerbatimArguments,
  verifyInstalledCli,
} from '../verify-installed-cli'
import { buildSafeElectronEnvironment } from '../safe-electron-environment'

const VALID_RESPONSE = JSON.stringify({
  schemaVersion: 1,
  type: 'response',
  command: 'list',
  result: { contract: 'local-session-v1', response: { outcome: { sessions: [] } } },
})

/** An installed CLI that answers the sessions list and the discovery checks correctly. */
function installedCli(overrides: Partial<Record<string, { stdout: string; stderr: string }>> = {}) {
  return vi.fn(async (_command: string, args: readonly string[]) => {
    const key = args[0] ?? ''
    const override = overrides[key]
    if (override) return override
    if (key === '--version') return { stdout: '0.4.0-alpha.10\n', stderr: '' }
    if (key === '--help') return { stdout: 'Usage:\n  openwaggle run <prompt>\n', stderr: '' }
    if (key === 'sesions') {
      return { stdout: '', stderr: "openwaggle: unknown command 'sesions'. Did you mean 'sessions'?\n" }
    }
    return { stdout: VALID_RESPONSE, stderr: '' }
  })
}

describe('installed CLI verification', () => {
  it('lets cmd.exe parse its /c command tail without Node CRT escaping', () => {
    expect(shouldUseWindowsVerbatimArguments('win32')).toBe(true)
    expect(shouldUseWindowsVerbatimArguments('linux')).toBe(false)
  })

  it('bounds a hanging wrapper and its surviving child with process-tree cleanup', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cli-tree-'))
    const script = path.join(root, 'hanging-wrapper.cjs')
    await fs.writeFile(
      script,
      [
        "const { spawn } = require('node:child_process')",
        "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' })",
        'setInterval(() => {}, 1000)',
      ].join('\n'),
    )

    try {
      const scriptArgument = process.platform === 'win32' ? `"${script}"` : script
      await expect(
        runInstalledCli(
          process.execPath,
          [scriptArgument],
          buildSafeElectronEnvironment({}),
          process.platform,
          { timeoutMs: 250 },
        ),
      ).rejects.toThrow('timed out after 250ms')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.each(['linux', 'darwin', 'win32'] satisfies NodeJS.Platform[])(
    'runs the installed command with an isolated profile and cleans its Host on %s',
    async (platform) => {
      const runCli = installedCli()
      const shutdownAndRemoveProfile = vi.fn(async () => undefined)

      await verifyInstalledCli('/installed/openwaggle', platform, {
        createProfile: async () => '/isolated/profile',
        runCli,
        shutdownAndRemoveProfile,
      })

      expect(runCli).toHaveBeenCalledWith(
        '/installed/openwaggle',
        ['sessions', 'list', '--all', '--limit', '1', '--json'],
        expect.objectContaining({
          OPENWAGGLE_AUTOMATION: '1',
          OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
          OPENWAGGLE_USER_DATA_DIR: '/isolated/profile',
        }),
        platform,
      )
      expect(shutdownAndRemoveProfile).toHaveBeenCalledWith('/isolated/profile')
    },
  )

  it('rejects a successful process that does not return the versioned sessions response', () => {
    expect(() => assertInstalledCliResponse('{}', 'darwin')).toThrow(
      'invalid sessions list response',
    )
  })

  it('uses the caller-provided fresh-shell PATH for Windows command resolution', async () => {
    const runCli = installedCli()

    await verifyInstalledCli('openwaggle', 'win32', {
      createProfile: async () => 'D:\\isolated-profile',
      environmentOverrides: {
        PATH: 'D:\\installed-openwaggle;C:\\Windows\\System32',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
      runCli,
      shutdownAndRemoveProfile: async () => undefined,
    })

    expect(runCli).toHaveBeenCalledWith(
      'openwaggle',
      expect.any(Array),
      expect.objectContaining({
        PATH: 'D:\\installed-openwaggle;C:\\Windows\\System32',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      }),
      'win32',
    )
  })

  it('preserves the CLI failure when Host cleanup also fails', async () => {
    const cliFailure = new Error('CLI failed')
    const cleanupFailure = new Error('cleanup failed')

    await expect(
      verifyInstalledCli('/installed/openwaggle', 'linux', {
        createProfile: async () => '/retained/profile',
        runCli: async () => Promise.reject(cliFailure),
        shutdownAndRemoveProfile: async () => Promise.reject(cleanupFailure),
      }),
    ).rejects.toMatchObject({ errors: [cliFailure, cleanupFailure] })
  })

  it('drains but retains the profile when process-tree exit is unproven', async () => {
    const cleanupFailure = new Error('process tree remains alive')
    const cliFailure = new InstalledCliProcessTreeExitUnprovenError(
      [new Error('CLI timeout'), cleanupFailure],
      'tree exit unproven',
    )
    const shutdownProfile = vi.fn(async () => undefined)
    const shutdownAndRemoveProfile = vi.fn(async () => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(
        verifyInstalledCli('/installed/openwaggle', 'win32', {
          createProfile: async () => 'D:\\retained-profile',
          runCli: async () => Promise.reject(cliFailure),
          shutdownProfile,
          shutdownAndRemoveProfile,
        }),
      ).rejects.toBe(cliFailure)
    } finally {
      error.mockRestore()
    }

    expect(shutdownProfile).toHaveBeenCalledWith('D:\\retained-profile')
    expect(shutdownAndRemoveProfile).not.toHaveBeenCalled()
  })

  it('checks that the installed command answers help, version, and typos itself', async () => {
    const runCli = installedCli()

    await verifyInstalledCli('/installed/openwaggle', 'linux', {
      createProfile: async () => '/isolated/profile',
      runCli,
      shutdownAndRemoveProfile: async () => undefined,
    })

    expect(runCli).toHaveBeenCalledWith(
      '/installed/openwaggle',
      ['sesions'],
      expect.any(Object),
      'linux',
      { expectedExitCode: 2 },
    )
  })

  it.each([
    ['--version', 'did not print its version'],
    ['--help', 'did not print its usage'],
    ['sesions', 'did not report a mistyped command'],
  ])('fails when %s opens the app instead of answering', async (argument, message) => {
    const runCli = installedCli({ [argument]: { stdout: '', stderr: '' } })

    await expect(
      verifyInstalledCli('/installed/openwaggle', 'darwin', {
        createProfile: async () => '/isolated/profile',
        runCli,
        shutdownAndRemoveProfile: async () => undefined,
      }),
    ).rejects.toThrow(message)
  })
})
