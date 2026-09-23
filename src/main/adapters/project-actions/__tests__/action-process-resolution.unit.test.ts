import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyRunner } from '../../terminal/terminal-pty-types'

const { spawn, stoppedBeforeLaunch } = vi.hoisted(() => ({
  spawn: vi.fn<PtyRunner['spawn']>(),
  stoppedBeforeLaunch: new Error('Stopped before native launch'),
}))
vi.mock('../../terminal/terminal-pty-runner', () => ({
  makePtyRunner: () => ({ spawn }),
}))

const { createActionProcessRunner, resolveActionExecutablePath } = await import('../action-process')
const RUNNER_NAME = 'ow-resolution-runner'
let workspace: string

async function executable(directory: string) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, RUNNER_NAME)
  await writeFile(path, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  return path
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ow-action-resolution-'))
  spawn.mockReset()
  spawn.mockResolvedValue({ ok: false, error: stoppedBeforeLaunch })
})
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

async function expectResolution(command: string, path: string, expected: string) {
  const runner = createActionProcessRunner('test')
  const invocation = {
    type: 'executable' as const,
    executable: command,
    args: ['argument with spaces'],
    cwd: workspace,
  }
  const environment = { PATH: path }
  await expect(runner.validate(invocation, environment)).resolves.toBeUndefined()
  await expect(runner.start({ invocation, environment, onOutput: () => {} })).rejects.toBe(
    stoppedBeforeLaunch,
  )
  expect(spawn).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: workspace,
      execution: { command: expected, args: invocation.args },
    }),
  )
}

describe('action executable resolution', () => {
  it('prefers a Windows PATHEXT shim over an extensionless POSIX shim', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    if (!platform) throw new Error('Missing process platform descriptor')
    const directory = join(workspace, 'bin')
    await mkdir(directory)
    await writeFile(join(directory, 'pnpm'), '#!/bin/sh\n')
    await writeFile(join(directory, 'pnpm.CMD'), '@echo off\r\n')
    await writeFile(join(directory, 'powershell.exe'), '')
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      const environment = { PATH: directory, PATHEXT: '.CMD' }
      await expect(resolveActionExecutablePath('pnpm', environment, workspace)).resolves.toBe(
        join(directory, 'pnpm.CMD'),
      )
      await expect(resolveActionExecutablePath('pnpm.CMD', environment, workspace)).resolves.toBe(
        join(directory, 'pnpm.CMD'),
      )
      await expect(
        resolveActionExecutablePath('pnpm', { PATH: directory, PATHEXT: '.EXE' }, workspace),
      ).resolves.toBe(join(directory, 'pnpm'))
      await expect(
        createActionProcessRunner('test').start({
          invocation: {
            type: 'executable',
            executable: 'pnpm',
            args: ['run', 'build'],
            cwd: workspace,
          },
          environment,
          onOutput: () => {},
        }),
      ).rejects.toBe(stoppedBeforeLaunch)
      expect(spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          execution: {
            command: join(directory, 'powershell.exe'),
            args: [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              expect.stringContaining(join(directory, 'pnpm.CMD')),
            ],
          },
        }),
      )
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it.skipIf(process.platform === 'win32')(
    'uses the final PowerShell command status for custom actions',
    async () => {
      const shell = join(workspace, 'pwsh')
      await writeFile(shell, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
      const invocation = {
        type: 'command' as const,
        command: '$global:LASTEXITCODE = 7; Write-Output "handled"',
        cwd: workspace,
      }
      await expect(
        createActionProcessRunner('test').start({
          invocation,
          environment: { SHELL: shell },
          onOutput: () => {},
        }),
      ).rejects.toBe(stoppedBeforeLaunch)
      expect(spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          execution: {
            command: shell,
            args: [
              '-NoLogo',
              '-NonInteractive',
              '-Command',
              `${invocation.command}\nif ($?) { exit 0 }; exit 1`,
            ],
          },
        }),
      )
    },
  )

  it('resolves a setup-provided relative PATH entry from the action directory', async () => {
    const expected = await executable(join(workspace, 'bin'))
    await expectResolution(RUNNER_NAME, 'bin', expected)
  })

  it.each(['.', '', `${delimiter}missing`, `missing${delimiter}`])(
    'uses the action directory for a current-directory PATH entry %j',
    async (path) => {
      const expected = await executable(workspace)
      await expectResolution(RUNNER_NAME, path, expected)
    },
  )

  it('resolves an explicit relative executable without searching PATH', async () => {
    const expected = await executable(join(workspace, 'bin'))
    const decoy = join(workspace, 'other-path-entry')
    await executable(join(decoy, 'bin'))
    await expectResolution(`./bin/${RUNNER_NAME}`, decoy, expected)
  })

  it('does not satisfy a missing explicit relative executable from a PATH directory', async () => {
    const decoy = join(workspace, 'other-path-entry')
    await executable(join(decoy, 'bin'))
    await expect(
      createActionProcessRunner('test').validate(
        {
          type: 'executable',
          executable: `./bin/${RUNNER_NAME}`,
          args: [],
          cwd: workspace,
        },
        { PATH: decoy },
      ),
    ).rejects.toThrow('Runner unavailable')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not treat an unset PATH as an explicit current-directory entry', async () => {
    await executable(workspace)
    await expect(
      createActionProcessRunner('test').validate(
        { type: 'executable', executable: RUNNER_NAME, args: [], cwd: workspace },
        { PATH: null },
      ),
    ).rejects.toThrow('Runner unavailable')
  })
})
