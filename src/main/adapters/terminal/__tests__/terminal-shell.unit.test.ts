import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  existingShells,
  posixShellCandidates,
  shellCandidates,
  windowsShellCandidates,
} from '../terminal-shell'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('terminal shell resolution', () => {
  it('prefers the current POSIX shell, then account shell, then platform fallbacks', () => {
    const candidates = posixShellCandidates(
      { SHELL: '/opt/homebrew/bin/fish' },
      { platform: 'linux', accountShell: '/bin/zsh' },
    )

    expect(candidates.map((candidate) => candidate.command)).toEqual([
      '/opt/homebrew/bin/fish',
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
      'bash',
      'zsh',
      'sh',
    ])
    expect(candidates.map((candidate) => candidate.args)).toEqual([
      ['--login', '--interactive'],
      ['-l', '-i', '-o', 'nopromptsp'],
      ['--login', '-i'],
      ['-l', '-i'],
      ['--login', '-i'],
      ['-l', '-i', '-o', 'nopromptsp'],
      ['-l', '-i'],
    ])
  })

  it('resolves the current SHELL afresh and deduplicates candidates', () => {
    const first = posixShellCandidates(
      { SHELL: '/bin/bash' },
      { platform: 'darwin', accountShell: '/bin/bash' },
    )
    const second = posixShellCandidates(
      { SHELL: '/bin/zsh' },
      { platform: 'darwin', accountShell: '/bin/bash' },
    )

    expect(first.map((candidate) => candidate.command)).toEqual([
      '/bin/bash',
      '/bin/zsh',
      '/bin/sh',
      'zsh',
      'bash',
      'sh',
    ])
    expect(second.map((candidate) => candidate.command)).toEqual([
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
      'zsh',
      'bash',
      'sh',
    ])
  })

  it('reads the OS account shell afresh for each resolution', () => {
    vi.spyOn(os, 'userInfo')
      .mockReturnValueOnce(accountInfo('/opt/tools/fish'))
      .mockReturnValueOnce(accountInfo('/opt/tools/zsh'))

    const first = posixShellCandidates({}, { platform: 'linux' })
    const second = posixShellCandidates({}, { platform: 'linux' })

    expect(first[0]?.command).toBe('/opt/tools/fish')
    expect(second[0]?.command).toBe('/opt/tools/zsh')
  })

  it('does not guess startup arguments for an unknown shell', () => {
    const [candidate] = posixShellCandidates(
      { SHELL: '/opt/tools/custom-shell' },
      { platform: 'linux', accountShell: null },
    )

    expect(candidate).toEqual({
      command: '/opt/tools/custom-shell',
      args: [],
      label: 'custom-shell',
    })
  })

  it('starts POSIX PowerShell with login profile semantics', () => {
    const [candidate] = posixShellCandidates(
      { SHELL: '/usr/local/bin/pwsh' },
      { platform: 'darwin', accountShell: null },
    )

    expect(candidate).toEqual({
      command: '/usr/local/bin/pwsh',
      args: ['-Login', '-NoLogo'],
      label: 'pwsh',
    })
  })

  it('keeps Windows PATH commands and adds absolute system fallbacks', () => {
    const candidates = windowsShellCandidates({
      Path: 'C:\\Tools',
      ProgramW6432: 'C:\\Program Files',
      ProgramFiles: 'c:\\program files',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'D:\\Tools\\custom-cmd.exe',
    })

    expect(candidates.map((candidate) => candidate.command)).toEqual([
      'pwsh.exe',
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'powershell.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'D:\\Tools\\custom-cmd.exe',
      'cmd.exe',
      'C:\\Windows\\System32\\cmd.exe',
    ])
    expect(candidates.find((candidate) => candidate.command === 'pwsh.exe')?.args).toEqual([
      '-NoLogo',
    ])
    expect(candidates.find((candidate) => candidate.command === 'cmd.exe')?.args).toEqual([])
  })

  it('does not stat bare Windows PATH commands out of the candidate chain', () => {
    const candidates = existingShells({
      environment: {},
      platform: 'win32',
      accountShell: null,
    })

    expect(candidates.map((candidate) => candidate.command)).toEqual(
      expect.arrayContaining(['pwsh.exe', 'powershell.exe', 'cmd.exe']),
    )
  })

  it('filters missing absolute paths while retaining available POSIX fallbacks', () => {
    const candidates = existingShells({
      environment: { SHELL: '/definitely/missing/openwaggle-shell' },
      platform: 'linux',
      accountShell: null,
    })

    expect(candidates.map((candidate) => candidate.command)).not.toContain(
      '/definitely/missing/openwaggle-shell',
    )
    expect(candidates.map((candidate) => candidate.command)).toContain('/bin/sh')
  })

  it('routes the platform through the unified resolver', () => {
    const candidates = shellCandidates({
      environment: { SystemRoot: 'C:\\Windows' },
      platform: 'win32',
      accountShell: null,
    })

    expect(candidates[0]?.command).toBe('pwsh.exe')
    expect(candidates).toContainEqual({ command: 'cmd.exe', args: [], label: 'cmd.exe' })
  })
})

function accountInfo(shell: string): ReturnType<typeof os.userInfo> {
  return {
    username: 'openwaggle-test',
    uid: 1000,
    gid: 1000,
    shell,
    homedir: '/home/openwaggle-test',
  }
}
