import { safeStorage } from 'electron'
import type { SecureStorageShape } from '../../ports/desktop-shell/secure-storage'

/** Electron's `safeStorage`: Keychain, DPAPI, libsecret or kwallet. */
export const electronSecureStorage: SecureStorageShape = {
  // safeStorage reads its key on first use, synchronously, and has no asynchronous read.
  warm: async () => undefined,
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plainText) => safeStorage.encryptString(plainText),
  decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  isAsyncEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encryptStringAsync: (plainText) => safeStorage.encryptStringAsync(plainText),
  decryptStringAsync: (encrypted) => safeStorage.decryptStringAsync(encrypted),
}
