import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { SecureStorageShape } from '../../secure-storage'

export interface SecureStorageContractHarness {
  readonly subject: SecureStorageShape
  /** Makes the operating system's key store unavailable, as on a Linux box without one. */
  readonly makeUnavailable: () => void
}

export const secureStorageContract = definePortContract<SecureStorageContractHarness>(
  'SecureStorage',
  {
    'round-trips a secret without storing it in the clear': async ({ subject }) => {
      expect(subject.isEncryptionAvailable()).toBe(true)
      const secret = 'sk-contract-secret-ü'
      const encrypted = subject.encryptString(secret)
      expect(encrypted.toString('utf8')).not.toContain(secret)
      expect(subject.decryptString(encrypted)).toBe(secret)
    },

    'opens off the calling thread what it sealed on it, and the reverse': async ({ subject }) => {
      await expect(subject.isAsyncEncryptionAvailable()).resolves.toBe(true)
      const secret = 'sk-contract-async-ü'
      const sealedAsync = await subject.encryptStringAsync(secret)
      expect(sealedAsync.toString('utf8')).not.toContain(secret)
      expect(subject.decryptString(sealedAsync)).toBe(secret)
      await expect(subject.decryptStringAsync(subject.encryptString(secret))).resolves.toEqual(
        expect.objectContaining({ result: secret }),
      )
    },

    'warms without rejecting and stays usable': async ({ subject }) => {
      await expect(subject.warm()).resolves.toBeUndefined()
      expect(subject.decryptString(subject.encryptString('after warm'))).toBe('after warm')
    },

    'refuses bytes it did not write': async ({ subject }) => {
      expect(() => subject.decryptString(Buffer.from('not a stored secret'))).toThrow()
      await expect(subject.decryptStringAsync(Buffer.from('not a stored secret'))).rejects.toThrow()
    },

    'throws instead of storing in the clear when no key store is available': async ({
      subject,
      makeUnavailable,
    }) => {
      makeUnavailable()
      expect(subject.isEncryptionAvailable()).toBe(false)
      expect(() => subject.encryptString('secret')).toThrow()
      await expect(subject.isAsyncEncryptionAvailable()).resolves.toBe(false)
      await expect(subject.encryptStringAsync('secret')).rejects.toThrow()
    },
  },
)
