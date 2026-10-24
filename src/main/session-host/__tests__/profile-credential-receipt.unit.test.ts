import { describe, expect, it } from 'vitest'
import {
  credentialReceiptRecord,
  isSameReceiptDirectory,
  parseCredentialReceipt,
} from '../profile-credential-receipt'

const targetPath = '/state/profile-credentials/reviewer.credential'
const durable = { device: '16777230', inode: '408642463', birthtime: '1792486351612449418' }
const observed = { directoryIdentity: '16777230:408642463', durableDirectoryIdentity: durable }
/** The same folder after a macOS reboot renumbered its volume. */
const afterReboot = {
  directoryIdentity: '16777233:408642463',
  durableDirectoryIdentity: { ...durable, device: '16777233' },
}

function receipt(directory: Record<string, unknown>) {
  return { targetPath, fingerprint: 'fingerprint', ...directory }
}

describe('credential receipt directory identity', () => {
  it('records the durable identity, not a device-bound `dev:ino` string', () => {
    expect(credentialReceiptRecord({ targetPath, fingerprint: 'f', directory: durable })).toEqual({
      targetPath,
      fingerprint: 'f',
      directory: durable,
    })
  })

  it('accepts the same folder after the device number changed', () => {
    const parsed = parseCredentialReceipt(receipt({ directory: durable }), targetPath)
    expect(isSameReceiptDirectory(parsed.directory, afterReboot)).toBe(true)
  })

  it.each([
    ['inode', { ...durable, inode: '408642464' }],
    ['birth time', { ...durable, birthtime: '1792486351612449419' }],
  ])('rejects a folder with a different %s', (_field, durableDirectoryIdentity) => {
    const parsed = parseCredentialReceipt(receipt({ directory: durable }), targetPath)
    expect(
      isSameReceiptDirectory(parsed.directory, { ...observed, durableDirectoryIdentity }),
    ).toBe(false)
  })

  it('compares the device number where the filesystem records no birth time', () => {
    const noBirth = { ...durable, birthtime: '0' }
    const parsed = parseCredentialReceipt(receipt({ directory: noBirth }), targetPath)
    expect(
      isSameReceiptDirectory(parsed.directory, { ...observed, durableDirectoryIdentity: noBirth }),
    ).toBe(true)
    expect(
      isSameReceiptDirectory(parsed.directory, {
        ...afterReboot,
        durableDirectoryIdentity: { ...noBirth, device: '16777233' },
      }),
    ).toBe(false)
  })

  it('reads a legacy `dev:ino` receipt by its inode alone', () => {
    const parsed = parseCredentialReceipt(
      receipt({ directoryIdentity: '16777230:408642463' }),
      targetPath,
    )
    expect(isSameReceiptDirectory(parsed.directory, observed)).toBe(true)
    expect(isSameReceiptDirectory(parsed.directory, afterReboot)).toBe(true)
    expect(
      isSameReceiptDirectory(parsed.directory, {
        ...afterReboot,
        directoryIdentity: '16777233:408642464',
      }),
    ).toBe(false)
  })

  it('prefers the durable identity when a receipt carries both', () => {
    const parsed = parseCredentialReceipt(
      receipt({ directory: durable, directoryIdentity: '16777230:408642463' }),
      targetPath,
    )
    expect(
      isSameReceiptDirectory(parsed.directory, {
        ...observed,
        durableDirectoryIdentity: { ...durable, birthtime: '1' },
      }),
    ).toBe(false)
  })

  it.each([
    ['no directory identity', {}],
    ['a malformed durable identity', { directory: { device: '1', inode: 2 } }],
    ['a durable identity with extra fields', { directory: { ...durable, path: '/x' } }],
    ['a non-numeric durable inode', { directory: { ...durable, inode: '' } }],
    ['a malformed legacy identity', { directoryIdentity: '408642463' }],
    ['a legacy identity with an empty inode', { directoryIdentity: '16777230:' }],
    [
      'a malformed durable identity next to a legacy one',
      { directory: null, directoryIdentity: '1:2' },
    ],
  ])('rejects a receipt with %s', (_case, directory) => {
    expect(() => parseCredentialReceipt(receipt(directory), targetPath)).toThrow(
      'Credential installation receipt is invalid.',
    )
  })

  it('rejects a receipt for another destination', () => {
    expect(() => parseCredentialReceipt(receipt({ directory: durable }), '/elsewhere')).toThrow(
      'Credential installation receipt is invalid.',
    )
  })
})
