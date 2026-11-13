import { createCipheriv, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createElectronSafeStorageReader,
  deriveCbcKey,
  SafeStorageDecryptError,
} from '../electron-safe-storage'

const FIXTURES = path.join(import.meta.dirname, 'fixtures')
const SPACES_IV = Buffer.alloc(16, ' ')

/** Chromium OSCrypt's CBC format, for formats no fixture covers yet. */
function cbcBlob(prefix: string, password: string, iterations: number, plaintext: string) {
  const cipher = createCipheriv('aes-128-cbc', deriveCbcKey(password, iterations), SPACES_IV)
  return Buffer.concat([Buffer.from(prefix), cipher.update(plaintext, 'utf8'), cipher.final()])
}

function gcmBlob(key: Buffer, plaintext: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('v10'), nonce, body, cipher.getAuthTag()])
}

function reasonOf(error: unknown) {
  return error instanceof SafeStorageDecryptError ? error.reason : undefined
}

async function macFixture() {
  const parsed: unknown = JSON.parse(
    await readFile(path.join(FIXTURES, 'electron-43-macos-mock-keychain.json'), 'utf8'),
  )
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('blob' in parsed) ||
    !('password' in parsed) ||
    !('plaintext' in parsed) ||
    typeof parsed.blob !== 'string' ||
    typeof parsed.password !== 'string' ||
    typeof parsed.plaintext !== 'string'
  ) {
    throw new Error('Invalid macOS fixture.')
  }
  return { blob: parsed.blob, password: parsed.password, plaintext: parsed.plaintext }
}

describe('Electron safeStorage reader', () => {
  it('opens a macOS v10 blob Electron 43 wrote, with the keychain item Electron names', async () => {
    const fixture = await macFixture()
    const readKeychainPassword = vi.fn(async () => fixture.password)
    const reader = createElectronSafeStorageReader({
      platform: 'darwin',
      appName: 'openwaggle',
      readKeychainPassword,
    })
    await expect(reader.decrypt(Buffer.from(fixture.blob, 'base64'))).resolves.toBe(
      fixture.plaintext,
    )
    await reader.decrypt(Buffer.from(fixture.blob, 'base64'))
    expect(readKeychainPassword).toHaveBeenCalledTimes(1)
    expect(readKeychainPassword).toHaveBeenCalledWith('openwaggle Safe Storage', 'openwaggle Key')
  })

  it('falls back to the account name older Electron dev builds used', async () => {
    const fixture = await macFixture()
    const readKeychainPassword = vi.fn(async (_service: string, account: string) =>
      account === 'openwaggle' ? fixture.password : null,
    )
    const reader = createElectronSafeStorageReader({
      platform: 'darwin',
      appName: 'openwaggle',
      readKeychainPassword,
    })
    await expect(reader.decrypt(Buffer.from(fixture.blob, 'base64'))).resolves.toBe(
      fixture.plaintext,
    )
    expect(readKeychainPassword.mock.calls).toEqual([
      ['openwaggle Safe Storage', 'openwaggle Key'],
      ['openwaggle Safe Storage', 'openwaggle'],
    ])
  })

  it('reports a refused or missing keychain item as an unavailable key', async () => {
    const fixture = await macFixture()
    const refused = createElectronSafeStorageReader({
      platform: 'darwin',
      appName: 'openwaggle',
      readKeychainPassword: async () => {
        throw new Error('User canceled the operation.')
      },
    })
    const missing = createElectronSafeStorageReader({
      platform: 'darwin',
      appName: 'openwaggle',
      readKeychainPassword: async () => null,
    })
    const blob = Buffer.from(fixture.blob, 'base64')
    expect(reasonOf(await refused.decrypt(blob).catch((error: unknown) => error))).toBe(
      'key-unavailable',
    )
    expect(reasonOf(await missing.decrypt(blob).catch((error: unknown) => error))).toBe(
      'key-unavailable',
    )
  })

  it('tells a wrong macOS key from an unavailable one', async () => {
    const fixture = await macFixture()
    const reader = createElectronSafeStorageReader({
      platform: 'darwin',
      appName: 'openwaggle',
      readKeychainPassword: async () => 'another password',
    })
    const error = await reader.decrypt(Buffer.from(fixture.blob, 'base64')).catch((e: unknown) => e)
    expect(reasonOf(error)).toBe('wrong-key')
  })

  it('opens Linux basic_text v10 without any keyring', async () => {
    const reader = createElectronSafeStorageReader({ platform: 'linux', appName: 'openwaggle' })
    await expect(reader.decrypt(cbcBlob('v10', 'peanuts', 1, 'plain store'))).resolves.toBe(
      'plain store',
    )
  })

  it('opens Linux v11 with the Secret Service password, and with the empty-password fallback', async () => {
    const readLinuxKeyringPassword = vi.fn(async () => 'keyring password')
    const reader = createElectronSafeStorageReader({
      platform: 'linux',
      appName: 'openwaggle',
      readLinuxKeyringPassword,
    })
    await expect(
      reader.decrypt(cbcBlob('v11', 'keyring password', 1, 'from libsecret')),
    ).resolves.toBe('from libsecret')
    await expect(reader.decrypt(cbcBlob('v11', '', 1, 'empty key'))).resolves.toBe('empty key')
    expect(readLinuxKeyringPassword).toHaveBeenCalledWith('openwaggle')
  })

  it('reports Linux v11 without a keyring as an unavailable key', async () => {
    const reader = createElectronSafeStorageReader({
      platform: 'linux',
      appName: 'openwaggle',
      readLinuxKeyringPassword: async () => null,
    })
    const error = await reader
      .decrypt(cbcBlob('v11', 'keyring password', 1, 'locked'))
      .catch((e: unknown) => e)
    expect(reasonOf(error)).toBe('key-unavailable')
  })

  it('opens Windows v10 with the DPAPI-unwrapped Local State key, trying every Local State', async () => {
    const key = randomBytes(32)
    const wrapped = Buffer.concat([Buffer.from('DPAPI'), Buffer.from('protected-key')])
    const unprotectDpapi = vi.fn(async (data: Buffer) =>
      data.equals(Buffer.from('protected-key')) ? key : randomBytes(32),
    )
    const stale = JSON.stringify({
      os_crypt: {
        encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('old')]).toString('base64'),
      },
    })
    const current = JSON.stringify({ os_crypt: { encrypted_key: wrapped.toString('base64') } })
    const reader = createElectronSafeStorageReader({
      platform: 'win32',
      appName: 'openwaggle',
      readWindowsLocalStates: async () => [stale, current],
      unprotectDpapi,
    })
    await expect(reader.decrypt(gcmBlob(key, 'windows secret'))).resolves.toBe('windows secret')
  })

  it('opens a raw Windows DPAPI blob through DPAPI itself', async () => {
    const dpapiBlob = Buffer.concat([
      Buffer.from('01000000d08c9ddf0115d1118c7a00c04fc297eb', 'hex'),
      Buffer.from('payload'),
    ])
    const reader = createElectronSafeStorageReader({
      platform: 'win32',
      appName: 'openwaggle',
      readWindowsLocalStates: async () => [],
      unprotectDpapi: async () => Buffer.from('legacy secret'),
    })
    expect(reader.format(dpapiBlob)).toBe('windows-dpapi')
    await expect(reader.decrypt(dpapiBlob)).resolves.toBe('legacy secret')
  })

  it('rejects a blob in no known format', async () => {
    const reader = createElectronSafeStorageReader({ platform: 'linux', appName: 'openwaggle' })
    const error = await reader.decrypt(Buffer.from('xyz-not-a-blob')).catch((e: unknown) => e)
    expect(reasonOf(error)).toBe('unknown-format')
  })
})
