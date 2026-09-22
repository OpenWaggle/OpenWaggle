import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparationCaptureInvocation } from '../preparation-shell-capture'

const invocation = { type: 'command', cwd: '/repo', command: 'source ./setup' } as const

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
    expect(
      await preparationCaptureInvocation(invocation, '/private/env', '/opt/pwsh', {}),
    ).toMatchObject({
      format: 'json',
      invocation: { executable: '/opt/pwsh' },
    })
  })
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
