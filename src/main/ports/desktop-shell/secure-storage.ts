import { Context } from 'effect'

/**
 * Encrypts small secrets with a key the operating system keeps for this user (ADR 0064): the MCP
 * secret vault, MCP OAuth credentials and CLI profile credentials.
 *
 * `encryptString` and `decryptString` throw when `isEncryptionAvailable()` is false, and
 * `decryptString` throws for bytes this storage did not write. The synchronous calls reach the key
 * store on the calling thread, where a slow or prompting keychain stalls the Host
 * (`.agents/memory/mcp.md`). The asynchronous calls do the same work off that thread, in the same
 * format: `decryptStringAsync` opens what `encryptString` wrote, and `decryptString` opens what
 * `encryptStringAsync` wrote.
 */
export interface SecureStorageShape {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (plainText: string) => Buffer
  readonly decryptString: (encrypted: Buffer) => string
  readonly isAsyncEncryptionAvailable: () => Promise<boolean>
  readonly encryptStringAsync: (plainText: string) => Promise<Buffer>
  readonly decryptStringAsync: (encrypted: Buffer) => Promise<{ readonly result: string }>
}

export class SecureStorage extends Context.Tag('@openwaggle/SecureStorage')<
  SecureStorage,
  SecureStorageShape
>() {}
