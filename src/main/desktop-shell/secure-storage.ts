import { electrobunSecureStorage } from '../adapters/electrobun/electrobun-secure-storage'
import type { SecureStorageShape } from '../ports/desktop-shell/secure-storage'

/** The desktop shell's SecureStorage (ADR 0064), bound to its Electrobun adapter. */
export const secureStorage: SecureStorageShape = electrobunSecureStorage
