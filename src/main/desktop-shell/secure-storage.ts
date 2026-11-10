import { electronSecureStorage } from '../adapters/electron/electron-secure-storage'
import type { SecureStorageShape } from '../ports/desktop-shell/secure-storage'

/** The desktop shell's SecureStorage (ADR 0064); the shell switch changes only this binding. */
export const secureStorage: SecureStorageShape = electronSecureStorage
