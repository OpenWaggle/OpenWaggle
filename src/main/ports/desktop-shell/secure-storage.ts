import { Context } from 'effect'

/**
 * Encrypts small secrets with a key the operating system keeps for this user (ADR 0064): the MCP
 * secret vault, MCP OAuth credentials and CLI profile credentials. Electron uses `safeStorage`
 * (Keychain, DPAPI, libsecret or kwallet); Electrobun uses `Bun.secrets` after a one-time
 * migration re-encrypts what `safeStorage` wrote.
 *
 * `encryptString` and `decryptString` throw when `isEncryptionAvailable()` is false, and
 * `decryptString` throws for bytes this storage did not write.
 */
export interface SecureStorageShape {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (plainText: string) => Buffer
  readonly decryptString: (encrypted: Buffer) => string
}

export class SecureStorage extends Context.Tag('@openwaggle/SecureStorage')<
  SecureStorage,
  SecureStorageShape
>() {}
