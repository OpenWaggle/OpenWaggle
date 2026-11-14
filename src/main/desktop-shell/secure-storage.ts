import { electronSecureStorage } from '../adapters/electron/electron-secure-storage'
import type { SecureStorageShape } from '../ports/desktop-shell/secure-storage'

/** The desktop shell's SecureStorage (ADR 0064), bound to its Electron adapter. */
export const secureStorage: SecureStorageShape = electronSecureStorage
