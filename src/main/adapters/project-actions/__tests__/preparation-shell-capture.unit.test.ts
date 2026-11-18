import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparationCaptureInvocation } from '../preparation-shell-capture'

const invocation = { type: 'command', cwd: '/repo', command: 'source ./setup' } as const
const powerShell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const powerShellAvailable =
  spawnSync(powerShell, ['-NoLogo', '-NonInteractive', '-Command', '$null']).status === 0
const failedNative = process.platform === 'win32' ? '& cmd.exe /c exit 7' : '& /usr/bin/false'
const nativeExitSeven =
  process.platform === 'win32' ? '& cmd.exe /c exit 7' : "& /bin/sh -c 'exit 7'"

describe('preparation shell selection', () => {
  it.each(['/bin/bash', '/bin/zsh', '/usr/bin/fish'])(
    'preserves the resolved shell %s',
    async (shell) => {
      expect(
        await preparationCaptureInvocation(invocation, '/private/env', shell, {}),
      ).toMatchObject({
        format: 'nul',
        invocation: { executable: shell, args: ['-c', expect.stringContaining('source ./setup')] },
      })
    },
  )
  it('uses the selected PowerShell and JSON capture even on a POSIX host', async () => {
    const capture = await preparationCaptureInvocation(invocation, '/private/env', '/opt/pwsh', {})
    expect(capture).toMatchObject({
      format: 'json',
      invocation: { executable: '/opt/pwsh' },
    })
    if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
    const script = capture.invocation.args[3]
    expect(script).toContain('$__ow_exit = 0\ntry {')
    expect(script).toContain('$__ow_succeeded = $?')
    expect(script).toContain('if ($__ow_succeeded) { $__ow_exit = 0 }')
    expect(script).toContain('GetCommandName()')
    expect(script).toContain('if ($__ow_exit -eq 0)')
    expect(script).toContain('exit $__ow_exit')
  })
  it.skipIf(!powerShellAvailable)('captures handled native failures with PowerShell', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ow-powershell-capture-'))
    const destination = join(directory, 'environment.json')
    try {
      const capture = await preparationCaptureInvocation(
        {
          type: 'command',
          cwd: directory,
          command: `${failedNative}; $env:OW_SETUP_HANDLED = "yes"`,
        },
        destination,
        powerShell,
        {},
      )
      if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
      const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
        cwd: directory,
        encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      expect(JSON.parse(await readFile(destination, 'utf8'))).toMatchObject({
        OW_SETUP_HANDLED: 'yes',
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it.skipIf(!powerShellAvailable)(
    'rejects a final non-terminating PowerShell cmdlet failure',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'ow-powershell-cmdlet-failure-'))
      const destination = join(directory, 'environment.json')
      try {
        const capture = await preparationCaptureInvocation(
          { type: 'command', cwd: directory, command: "Get-Item -LiteralPath './missing-item'" },
          destination,
          powerShell,
          {},
        )
        if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
        const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
          cwd: directory,
          encoding: 'utf8',
        })
        expect(result.status).toBe(1)
        await expect(readFile(destination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
  it.skipIf(!powerShellAvailable)(
    'does not reuse an earlier native exit code for a final Setup cmdlet failure',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'ow-powershell-setup-stale-native-'))
      const destination = join(directory, 'environment.json')
      try {
        const capture = await preparationCaptureInvocation(
          {
            type: 'command',
            cwd: directory,
            command: `${nativeExitSeven}; Write-Error 'failed'`,
          },
          destination,
          powerShell,
          {},
        )
        if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
        const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
          cwd: directory,
          encoding: 'utf8',
        })
        expect(result.status).toBe(1)
        await expect(readFile(destination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
  it.skipIf(!powerShellAvailable)(
    'captures a dot-sourced PowerShell setup that exits zero',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'ow-powershell-exit-capture-'))
      const destination = join(directory, 'environment.json')
      try {
        await writeFile(join(directory, 'setup.ps1'), '$env:OW_SETUP_EXIT_ZERO = "yes"\nexit 0\n')
        const capture = await preparationCaptureInvocation(
          { type: 'command', cwd: directory, command: '. ./setup.ps1' },
          destination,
          powerShell,
          {},
        )
        if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
        const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
          cwd: directory,
          encoding: 'utf8',
        })
        expect(result.status).toBe(0)
        expect(JSON.parse(await readFile(destination, 'utf8'))).toMatchObject({
          OW_SETUP_EXIT_ZERO: 'yes',
        })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
  it('resolves a Windows task shim before constructing the PowerShell wrapper', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ow-setup-shim-'))
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    if (!platform) throw new Error('Missing process platform descriptor')
    try {
      await writeFile(join(directory, 'npm.CMD'), '@echo off\r\n')
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      const capture = await preparationCaptureInvocation(
        { type: 'executable', executable: 'npm', args: ['run', 'setup'], cwd: directory },
        join(directory, 'environment'),
        '/opt/pwsh',
        { PATH: directory, PATHEXT: '.CMD' },
      )
      if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
      expect(capture.invocation.args[3]).toContain(join(directory, 'npm.CMD'))
      expect(capture.invocation.args[3]).not.toContain("& 'npm' ")
    } finally {
      Object.defineProperty(process, 'platform', platform)
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('rejects unsupported capture shells before launching user code', async () => {
    await expect(
      preparationCaptureInvocation(invocation, '/private/env', '/bin/tcsh', {}),
    ).rejects.toThrow(
      'Setup environment capture is not supported by the configured shell: /bin/tcsh',
    )
  })
})
