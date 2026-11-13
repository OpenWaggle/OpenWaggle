import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type {
  WindowsHeadlessLaunchInput,
  WindowsHeadlessProcess,
} from '../../windows-headless-process'
import { startSessionHostPrelaunch, windowsHostPipePresent } from '../session-host-prelaunch'
import { PROFILE, prelaunchInput } from './session-host-prelaunch-fixtures'

describe('startSessionHostPrelaunch on Windows', () => {
  it('starts a Windows Host without its handles, with the libuv variables, and records it', () => {
    const exited = { value: false }
    const startWindows = vi.fn(
      (_launch: WindowsHeadlessLaunchInput) =>
        ({
          hasExited: () => exited.value,
        }) satisfies WindowsHeadlessProcess,
    )
    const { input, spawn, record } = prelaunchInput({
      platform: 'win32',
      executablePath: 'C:\\OpenWaggle\\bin\\bun.exe',
      windowsHostPresent: () => false,
      startWindows,
    })
    const environment = { ...input.environment, SystemRoot: 'C:\\Windows', SYSTEMROOT: 'C:\\W' }

    expect(startSessionHostPrelaunch({ ...input, environment })).toEqual({ kind: 'launch' })

    expect(spawn).not.toHaveBeenCalled()
    const launch = startWindows.mock.calls[0]?.[0]
    expect(launch?.command).toBe('C:\\OpenWaggle\\bin\\bun.exe')
    expect(launch?.args.at(-1)).toBe('session-host-internal')
    expect(launch?.environment).toMatchObject({ OPENWAGGLE_USER_DATA_DIR: PROFILE })
    expect(launch?.environment).not.toHaveProperty('OPENWAGGLE_PROFILE')
    expect(launch?.inherited).toMatchObject({ PATH: '/usr/bin', SYSTEMROOT: 'C:\\W' })
    const prelaunch = record.mock.calls[0]?.[0]
    expect(prelaunch?.hasEnded()).toBe(false)
    exited.value = true
    expect(prelaunch?.hasEnded()).toBe(true)
    return expect(prelaunch?.ended).resolves.toBeUndefined()
  })

  it('leaves the GUI its own Windows launch when the Host cannot start', () => {
    const { input, record } = prelaunchInput({
      platform: 'win32',
      executablePath: 'C:\\OpenWaggle\\bin\\bun.exe',
      windowsHostPresent: () => false,
      startWindows: () => {
        throw new Error('Windows headless process launch failed at create-process (Win32 code 2).')
      },
    })
    expect(startSessionHostPrelaunch(input)).toBeNull()
    expect(record).not.toHaveBeenCalled()
  })

  it('finds a Windows Host by the pipe its published capability names', async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'prelaunch-windows-'))
    try {
      const pipeExists = vi.fn(() => true)
      expect(windowsHostPipePresent(profile, pipeExists)).toBe(false)
      await mkdir(path.join(profile, 'session-host'))
      const capabilityFile = path.join(profile, 'session-host', 'endpoint.capability')
      await writeFile(capabilityFile, 'not a capability\n')
      expect(windowsHostPipePresent(profile, pipeExists)).toBe(false)
      expect(pipeExists).not.toHaveBeenCalled()

      const capability = 'A'.repeat(43)
      await writeFile(capabilityFile, `${capability}\n`)
      expect(windowsHostPipePresent(profile, pipeExists)).toBe(true)
      expect(pipeExists).toHaveBeenCalledWith(`\\\\.\\pipe\\openwaggle-${capability}-session-host`)
      expect(windowsHostPipePresent(profile, () => false)).toBe(false)
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  })
})
