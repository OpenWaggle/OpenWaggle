import { safeStorage } from 'electron'
import { createLogger } from '../logger'

const logger = createLogger('encryption')

const ENCRYPTED_PREFIX = 'enc:v1:'

export function isEncryptedString(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptString(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('safeStorage unavailable — value stored as plaintext')
    return value
  }
  try {
    const encrypted = safeStorage.encryptString(value)
    return `${ENCRYPTED_PREFIX}${encrypted.toString('base64')}`
  } catch {
    logger.warn('Encryption failed — value stored as plaintext')
    return value
  }
}

export function decryptString(stored: string): string {
  if (!stored) return ''
  if (!isEncryptedString(stored)) return stored
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('safeStorage encryption is unavailable — encrypted values cannot be decrypted.')
    return ''
  }

  const payload = stored.slice(ENCRYPTED_PREFIX.length)
  try {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  } catch {
    logger.warn('Failed to decrypt value — the stored value may be corrupted.')
    return ''
  }
}
