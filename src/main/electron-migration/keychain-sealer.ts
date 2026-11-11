/**
 * The format the Electrobun build seals secrets in once they leave Electron's `safeStorage`:
 * `ow1` + a 12-byte nonce + AES-256-GCM ciphertext + a 16-byte tag, keyed by one random 256-bit key
 * that lives in the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service) through
 * `Bun.secrets` or any store with the same shape. Files keep their layout; only the blob changes, so
 * the vault, the OAuth store and profile credentials need no new file formats, and a blob's prefix
 * alone says whether it has been migrated.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const SEALED_PREFIX = Buffer.from('ow1')
const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16

/** `Bun.secrets`' shape. */
export interface KeychainSecrets {
  readonly get: (options: {
    readonly service: string
    readonly name: string
  }) => Promise<string | null>
  readonly set: (options: {
    readonly service: string
    readonly name: string
    readonly value: string
  }) => Promise<void>
}

export interface KeychainSealerOptions {
  readonly secrets: KeychainSecrets
  /** The keychain item; it decides which builds share secrets, as `<app name> Safe Storage` did. */
  readonly service: string
  readonly name: string
  /**
   * Serializes the first key creation across processes (the desktop app and the Session Host may
   * both start sealing): without it two processes could each store a key and one would lose.
   */
  readonly withCreationLock: <T>(operation: () => Promise<T>) => Promise<T>
}

export class KeychainSealerError extends Error {}

export function isSealedBlob(blob: Buffer) {
  return blob.subarray(0, SEALED_PREFIX.length).equals(SEALED_PREFIX)
}

function decodeKey(encoded: string) {
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new KeychainSealerError('The keychain secret-storage key is invalid.')
  }
  return key
}

export function createKeychainSealer(options: KeychainSealerOptions) {
  const item = { service: options.service, name: options.name }
  let cachedKey: Promise<Buffer> | undefined

  async function existingKey() {
    const stored = await options.secrets.get(item)
    return stored === null ? undefined : decodeKey(stored)
  }

  async function loadKey(create: boolean) {
    const found = await existingKey()
    if (found) return found
    if (!create) throw new KeychainSealerError('The keychain has no secret-storage key yet.')
    return options.withCreationLock(async () => {
      const raced = await existingKey()
      if (raced) return raced
      await options.secrets.set({ ...item, value: randomBytes(KEY_BYTES).toString('base64') })
      // Read back what the keychain kept, so this process never seals with a key it failed to store.
      const stored = await existingKey()
      if (!stored) {
        throw new KeychainSealerError('The keychain did not keep the secret-storage key.')
      }
      return stored
    })
  }

  function key(create: boolean) {
    const pending = (cachedKey ??= loadKey(create))
    // A failed read must not stick: the next call asks the keychain again.
    pending.catch(() => {
      if (cachedKey === pending) cachedKey = undefined
    })
    return pending
  }

  async function seal(plaintext: string) {
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', await key(true), nonce)
    cipher.setAAD(SEALED_PREFIX)
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([SEALED_PREFIX, nonce, body, cipher.getAuthTag()])
  }

  async function open(blob: Buffer) {
    if (!isSealedBlob(blob) || blob.length < SEALED_PREFIX.length + NONCE_BYTES + TAG_BYTES) {
      throw new KeychainSealerError('This secret is not in the keychain-sealed format.')
    }
    const nonceEnd = SEALED_PREFIX.length + NONCE_BYTES
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await key(false),
      blob.subarray(SEALED_PREFIX.length, nonceEnd),
    )
    decipher.setAAD(SEALED_PREFIX)
    decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES))
    return Buffer.concat([
      decipher.update(blob.subarray(nonceEnd, blob.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8')
  }

  return { seal, open }
}
