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

    'refuses bytes it did not write': async ({ subject }) => {
      expect(() => subject.decryptString(Buffer.from('not a stored secret'))).toThrow()
    },

    'throws instead of storing in the clear when no key store is available': async ({
      subject,
      makeUnavailable,
    }) => {
      makeUnavailable()
      expect(subject.isEncryptionAvailable()).toBe(false)
      expect(() => subject.encryptString('secret')).toThrow()
    },
  },
)
