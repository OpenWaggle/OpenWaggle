import { describe, expect, it, vi } from 'vitest'

const mockIsEncryptionAvailable = vi.hoisted(() => vi.fn())
const mockEncryptString = vi.hoisted(() => vi.fn())
const mockDecryptString = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mockIsEncryptionAvailable,
    encryptString: mockEncryptString,
    decryptString: mockDecryptString,
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

describe('encryption', () => {
  describe('encryptString', () => {
    it('returns empty string for empty input', async () => {
      const { encryptString } = await import('../encryption')
      expect(encryptString('')).toBe('')
    })

    it('returns raw value with warning when encryption is unavailable', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      const { encryptString } = await import('../encryption')
      expect(encryptString('my-secret')).toBe('my-secret')
    })

    it('returns prefixed base64 when encryption is available', async () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockEncryptString.mockReturnValue(Buffer.from('encrypted-data'))

      const { encryptString } = await import('../encryption')
      const result = encryptString('my-secret')

      expect(result).toMatch(/^enc:v1:/)
      expect(mockEncryptString).toHaveBeenCalledWith('my-secret')
    })

    it('returns raw value with warning when encryption throws', async () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockEncryptString.mockImplementation(() => {
        throw new Error('encryption failed')
      })

      const { encryptString } = await import('../encryption')
      expect(encryptString('my-secret')).toBe('my-secret')
    })
  })

  describe('decryptString', () => {
    it('returns empty string for empty input', async () => {
      const { decryptString } = await import('../encryption')
      expect(decryptString('')).toBe('')
    })

    it('returns raw value when no prefix is present (unencrypted)', async () => {
      const { decryptString } = await import('../encryption')
      expect(decryptString('plain-key')).toBe('plain-key')
    })

    it('returns empty string when encryption is unavailable and prefix is present', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      const { decryptString } = await import('../encryption')
      expect(decryptString('enc:v1:somedata')).toBe('')
    })

    it('round-trips with encryptString', async () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      const original = 'sk-test-key-12345'
      mockEncryptString.mockReturnValue(Buffer.from(original))
      mockDecryptString.mockReturnValue(original)

      const { encryptString, decryptString } = await import('../encryption')
      const encrypted = encryptString(original)
      const decrypted = decryptString(encrypted)

      expect(decrypted).toBe(original)
    })

    it('returns empty string when decryption throws', async () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockDecryptString.mockImplementation(() => {
        throw new Error('decryption failed')
      })

      const { decryptString } = await import('../encryption')
      expect(decryptString('enc:v1:corrupted')).toBe('')
    })
  })

  describe('isEncryptionAvailable', () => {
    it('returns true when safeStorage is available', async () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      const { isEncryptionAvailable } = await import('../encryption')
      expect(isEncryptionAvailable()).toBe(true)
    })

    it('returns false when safeStorage is unavailable', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      const { isEncryptionAvailable } = await import('../encryption')
      expect(isEncryptionAvailable()).toBe(false)
    })
  })
})
