import { safeStorage } from 'electron'
import type { SecureStorageShape } from '../../ports/desktop-shell/secure-storage'

/** Electron's `safeStorage`: Keychain, DPAPI, libsecret or kwallet. */
export const electronSecureStorage: SecureStorageShape = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plainText) => safeStorage.encryptString(plainText),
  decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  isAsyncEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encryptStringAsync: (plainText) => safeStorage.encryptStringAsync(plainText),
  decryptStringAsync: (encrypted) => safeStorage.decryptStringAsync(encrypted),
}
