import { TIME_UNIT } from '@shared/constants/time'
import { McpVaultError } from '../../ports/mcp-errors'

/**
 * How long an asynchronous keychain call may take. Without a login keychain, or with a prompt
 * nobody answers, macOS never returns from it; the operation fails instead of hanging a Run or a
 * save.
 */
export const MCP_KEYCHAIN_TIMEOUT_MS = 20_000

/** The keychain's answer, or a clear failure once `MCP_KEYCHAIN_TIMEOUT_MS` has passed. */
async function answered<T>(operation: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new McpVaultError({
            reason: 'encryption-unavailable',
            message: `The system keychain did not answer within ${String(MCP_KEYCHAIN_TIMEOUT_MS / TIME_UNIT.MILLISECONDS_PER_SECOND)} s, so the MCP secret could not be read or saved. Unlock the keychain, or answer its prompt, and try again.`,
          }),
        ),
      MCP_KEYCHAIN_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

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
    ? answered(encryption.isAsyncEncryptionAvailable())
    : encryption.isEncryptionAvailable()
}

export async function encrypt(encryption: McpVaultEncryption, value: string) {
  return encryption.encryptStringAsync
    ? answered(encryption.encryptStringAsync(value))
    : encryption.encryptString(value)
}

export async function decrypt(encryption: McpVaultEncryption, value: Buffer) {
  return encryption.decryptStringAsync
    ? (await answered(encryption.decryptStringAsync(value))).result
    : encryption.decryptString(value)
}
