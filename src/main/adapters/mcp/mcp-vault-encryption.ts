/**
 * Electron's `safeStorage`. Its synchronous calls read the keychain on the main thread, where a
 * slow or prompting keychain freezes the whole Host; the asynchronous ones (Electron 43) do it off
 * the main thread and use the same format, so `decryptStringAsync` opens what `encryptString`
 * sealed. The vault uses them when present; test doubles may offer only the synchronous ones.
 */
export interface McpVaultEncryption {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (value: string) => Buffer
  readonly decryptString: (value: Buffer) => string
  readonly isAsyncEncryptionAvailable?: () => Promise<boolean>
  readonly encryptStringAsync?: (value: string) => Promise<Buffer>
  readonly decryptStringAsync?: (value: Buffer) => Promise<{ readonly result: string }>
}

export async function encryptionAvailable(encryption: McpVaultEncryption) {
  return encryption.isAsyncEncryptionAvailable
    ? encryption.isAsyncEncryptionAvailable()
    : encryption.isEncryptionAvailable()
}

export async function encrypt(encryption: McpVaultEncryption, value: string) {
  return encryption.encryptStringAsync
    ? encryption.encryptStringAsync(value)
    : encryption.encryptString(value)
}

export async function decrypt(encryption: McpVaultEncryption, value: Buffer) {
  return encryption.decryptStringAsync
    ? (await encryption.decryptStringAsync(value)).result
    : encryption.decryptString(value)
}
