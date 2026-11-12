import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { temporaryTestDirectory } from '../../test-support/temporary-test-directory'
import { type CommandRunner, createOsKeySources, DPAPI_UNPROTECT_SCRIPT } from '../os-key-sources'

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

describe('OS key sources for the Electron safeStorage reader', () => {
  it('reads the macOS keychain item through the injected keychain', async () => {
    const get = vi.fn(async () => 'keychain-password')
    const sources = createOsKeySources({
      platform: 'darwin',
      appName: 'openwaggle',
      userData: '/unused',
      keychain: { get },
      runCommand: vi.fn<CommandRunner>(),
    })
    await expect(
      sources.readKeychainPassword?.('openwaggle Safe Storage', 'openwaggle Key'),
    ).resolves.toBe('keychain-password')
    expect(get).toHaveBeenCalledWith({ service: 'openwaggle Safe Storage', name: 'openwaggle Key' })
  })

  it('reads the Secret Service item first, then KWallet', async () => {
    const runCommand = vi.fn<CommandRunner>(async (command) =>
      command === 'secret-tool' ? { exitCode: 1, stdout: '', stderr: '' } : ok('wallet-password\n'),
    )
    const sources = createOsKeySources({
      platform: 'linux',
      appName: 'openwaggle',
      userData: '/unused',
      runCommand,
    })
    await expect(sources.readLinuxKeyringPassword?.('openwaggle')).resolves.toBe('wallet-password')
    expect(runCommand.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
      ['secret-tool', 'lookup', 'application', 'openwaggle'],
      ['kwallet-query', '-r', 'openwaggle Safe Storage', '-f', 'openwaggle Keys', 'kdewallet'],
    ])
  })

  it('reports a refused keyring instead of treating it as no key', async () => {
    const runCommand: CommandRunner = async (command) =>
      command === 'secret-tool'
        ? { exitCode: 1, stdout: '', stderr: 'Prompt dismissed' }
        : { exitCode: 1, stdout: '', stderr: '' }
    const sources = createOsKeySources({
      platform: 'linux',
      appName: 'openwaggle',
      userData: '/unused',
      runCommand,
    })
    await expect(sources.readLinuxKeyringPassword?.('openwaggle')).rejects.toThrow(/refused/u)
  })

  it('reads Local State from session-data and the profile root, and unprotects with DPAPI', async () => {
    const userData = await temporaryTestDirectory('ow-os-key-sources-')
    await mkdir(path.join(userData, 'session-data'))
    await writeFile(path.join(userData, 'session-data', 'Local State'), '{"current":true}')
    await writeFile(path.join(userData, 'Local State'), '{"legacy":true}')
    const runCommand = vi.fn<CommandRunner>(async () => ok(Buffer.from('plain').toString('base64')))
    const sources = createOsKeySources({
      platform: 'win32',
      appName: 'openwaggle',
      userData,
      runCommand,
      powershellPath: 'pwsh.exe',
    })
    await expect(sources.readWindowsLocalStates?.()).resolves.toEqual([
      '{"current":true}',
      '{"legacy":true}',
    ])
    await expect(sources.unprotectDpapi?.(Buffer.from('sealed'))).resolves.toEqual(
      Buffer.from('plain'),
    )
    expect(runCommand.mock.calls[0]?.[0]).toBe('pwsh.exe')
    expect(runCommand.mock.calls[0]?.[2]).toBe(Buffer.from('sealed').toString('base64'))
    expect(runCommand.mock.calls[0]?.[1].at(-1)).toBe(DPAPI_UNPROTECT_SCRIPT)
  })

  it('unprotects without running a cmdlet, which would start PowerShell module analysis', () => {
    // A cmdlet is Verb-Noun outside a .NET type reference; the script only calls .NET.
    const withoutTypes = DPAPI_UNPROTECT_SCRIPT.replaceAll(/\[[^\]]*\]/gu, '')
    expect(withoutTypes).not.toMatch(/\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b/u)
  })
})
