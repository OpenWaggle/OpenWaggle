import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserImportError } from '../browser-import-errors'
import {
  decodeWindowsWrappedKey,
  deriveChromiumCbcKey,
  resolveChromiumKeys,
} from '../chromium-cookie-keys'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
  vi.unstubAllEnvs()
})

async function localState(contents: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-chromium-key-test-'))
  temporaryDirectories.push(directory)
  const filePath = path.join(directory, 'Local State')
  await writeFile(filePath, JSON.stringify(contents))
  return filePath
}

function reasonOf(error: unknown) {
  return error instanceof BrowserImportError ? error.reason : undefined
}

describe('Chromium cookie keys', () => {
  it('derives Chromium OSCrypt CBC vectors exactly', () => {
    expect(deriveChromiumCbcKey('test-secret', 1_003).toString('hex')).toBe(
      '01ab06dc67d036480129f3e40d53ca5f',
    )
    expect(deriveChromiumCbcKey('peanuts', 1).toString('hex')).toBe(
      'fd621fe5a2b402539dfa147ca9272778',
    )
  })

  it('uses the in-process macOS keychain coordinates supplied by the source', async () => {
    const readMacSecret = vi.fn(async () => 'test-secret')

    const keys = await resolveChromiumKeys(
      {
        platform: 'darwin',
        keychainService: 'Chrome Safe Storage',
        keychainAccount: 'Chrome',
      },
      { readMacSecret },
    )

    expect(readMacSecret).toHaveBeenCalledExactlyOnceWith('Chrome Safe Storage', 'Chrome')
    expect(keys.cbcV10?.toString('hex')).toBe('01ab06dc67d036480129f3e40d53ca5f')
  })

  it('distinguishes a missing macOS item from denied keychain access', async () => {
    await expect(
      resolveChromiumKeys(
        {
          platform: 'darwin',
          keychainService: 'Chrome Safe Storage',
          keychainAccount: 'Chrome',
        },
        { readMacSecret: async () => null },
      ),
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'keychain-item-missing')

    await expect(
      resolveChromiumKeys(
        {
          platform: 'darwin',
          keychainService: 'Chrome Safe Storage',
          keychainAccount: 'Chrome',
        },
        {
          readMacSecret: async () => {
            throw new Error('User interaction is not allowed')
          },
        },
      ),
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'needs-keychain-approval')
  })

  it('derives Linux v10 and v11 keys while retaining non-consent failures for partial reads', async () => {
    const runHelper = vi.fn(async () => ({ exitCode: 0, stdout: 'linux-secret\n', stderr: '' }))
    const keys = await resolveChromiumKeys(
      { platform: 'linux', linuxSecretApplication: 'chrome' },
      { runHelper },
    )

    expect(runHelper).toHaveBeenCalledExactlyOnceWith('/usr/bin/secret-tool', [
      'lookup',
      'application',
      'chrome',
    ])
    expect(keys.cbcV10?.toString('hex')).toBe('fd621fe5a2b402539dfa147ca9272778')
    expect(keys.cbcV11).toHaveLength(16)

    const partial = await resolveChromiumKeys(
      { platform: 'linux', linuxSecretApplication: 'chrome' },
      { runHelper: async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }) },
    )
    expect(partial.cbcV10).toHaveLength(16)
    expect(partial.cbcV11).toBeUndefined()
    expect(partial.cbcV11Error?.reason).toBe('keychain-item-missing')
  })

  it('does not silently downgrade an explicit Linux keyring denial', async () => {
    await expect(
      resolveChromiumKeys(
        { platform: 'linux', linuxSecretApplication: 'chrome' },
        { runHelper: async () => ({ exitCode: 1, stdout: '', stderr: 'Access denied' }) },
      ),
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'needs-keychain-approval')
  })

  it('unwraps only legacy Windows DPAPI keys and keeps the wrapped secret out of argv', async () => {
    const wrapped = Buffer.from('wrapped-key-material')
    const plain = Buffer.alloc(32, 0x7a)
    const statePath = await localState({
      os_crypt: {
        encrypted_key: Buffer.concat([Buffer.from('DPAPI'), wrapped]).toString('base64'),
      },
    })
    const runHelper = vi.fn(async (_command: string, args: readonly string[], input?: string) => {
      expect(args.join(' ')).not.toContain(wrapped.toString('base64'))
      expect(input).toBe(wrapped.toString('base64'))
      return { exitCode: 0, stdout: plain.toString('base64'), stderr: '' }
    })

    const keys = await resolveChromiumKeys(
      { platform: 'win32', windowsLocalStatePath: statePath },
      { runHelper },
    )

    expect(keys.gcmV10).toEqual(plain)
    expect(runHelper).toHaveBeenCalledOnce()
  })

  it('rejects Windows App-Bound Encryption and malformed base64', () => {
    expect(() =>
      decodeWindowsWrappedKey(
        JSON.stringify({
          os_crypt: { encrypted_key: 'RFBBUEk=', app_bound_encrypted_key: 'present' },
        }),
      ),
    ).toThrow('App-Bound Encryption')
    expect(() =>
      decodeWindowsWrappedKey(JSON.stringify({ os_crypt: { encrypted_key: 'DPAPI***' } })),
    ).toThrow('encryption key is invalid')
  })
})
