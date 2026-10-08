import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpSecretSummary } from '@shared/types/mcp'
import { Effect, Layer } from 'effect'
import { safeStorage } from 'electron'
import { McpVaultError, toMcpVaultError } from '../../ports/mcp-errors'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import {
  mcpBuildStateDirectory,
  sharedMcpStateDirectory,
} from './credentials/mcp-build-state-paths'
import {
  decrypt,
  encrypt,
  encryptionAvailable,
  type McpVaultEncryption,
} from './mcp-vault-encryption'
import {
  EMPTY_VAULT,
  readVaultFile,
  summaries,
  type VaultEntry,
  type VaultFile,
  writeVault,
} from './mcp-vault-file'
import { withProcessFileLock } from './process-file-lock'

function validateSecretName(name: string) {
  const normalized = name.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(normalized)) {
    throw new McpVaultError({
      reason: 'validation',
      message:
        'MCP secret names must be 1-128 characters and use letters, numbers, dot, underscore, or dash.',
    })
  }
  return normalized
}

async function decryptsWith(encryption: McpVaultEncryption, entry: VaultEntry) {
  try {
    await decrypt(encryption, Buffer.from(entry.encryptedValue, 'base64'))
    return true
  } catch {
    return false
  }
}

/** The shared pre-build vault; one that cannot be parsed has nothing to take over. */
async function readLegacyVault(legacyFilePath: string | undefined) {
  if (!legacyFilePath) return undefined
  return readVaultFile(legacyFilePath).catch((error: unknown) => {
    if (error instanceof SyntaxError || error instanceof McpVaultError) return undefined
    throw error
  })
}

/**
 * The entries of the shared pre-build vault this build's key opens; the others are another
 * build's. Throws when encryption is unavailable, so the takeover is not recorded as done.
 */
async function ownLegacySecrets(legacy: VaultFile, encryption: McpVaultEncryption) {
  await assertEncryptionAvailable(encryption)
  const entries = Object.entries(legacy.secrets)
  const opens = await Promise.all(entries.map(([, entry]) => decryptsWith(encryption, entry)))
  return Object.fromEntries(entries.filter((_, index) => opens[index]))
}

async function assertEncryptionAvailable(encryption: McpVaultEncryption) {
  if (!(await encryptionAvailable(encryption))) {
    throw new McpVaultError({
      reason: 'encryption-unavailable',
      message:
        'Operating-system encryption is unavailable, so OpenWaggle will not read or write MCP secrets.',
    })
  }
}

export interface EncryptedMcpSecretVaultOptions {
  /**
   * The vault every build shared before it moved to user data; it is never changed. While this
   * build has no vault, reads use it (names without decrypting, a value decrypted when resolved),
   * and the first save copies the secrets this build can decrypt.
   */
  readonly legacyFilePath?: string
}

export function createEncryptedMcpSecretVault(
  filePath: string,
  encryption: McpVaultEncryption = safeStorage,
  options: EncryptedMcpSecretVaultOptions = {},
) {
  let writeQueue: Promise<void> = Promise.resolve()

  /**
   * This build's vault, or while it has none, the shared vault every build used before: its names
   * are read without decrypting anything, and an entry is decrypted only when it is resolved. Reads
   * keep no state, so a read never hides what a concurrent save or a later attempt takes over.
   */
  async function readVault() {
    const own = await readVaultFile(filePath)
    if (own) return { vault: own, shared: false }
    const legacy = await readLegacyVault(options.legacyFilePath)
    return { vault: legacy ?? EMPTY_VAULT, shared: legacy !== undefined }
  }

  /**
   * The vault a save starts from, under the vault's lock. The first save takes over the shared
   * vault's secrets this build's key opens; it fails, and records nothing, when it cannot decrypt.
   */
  async function vaultToChange() {
    const own = await readVaultFile(filePath)
    if (own) return own
    const legacy = await readLegacyVault(options.legacyFilePath)
    if (!legacy) return EMPTY_VAULT
    return { version: 1 as const, secrets: await ownLegacySecrets(legacy, encryption) }
  }

  async function mutate(
    update: (vault: VaultFile) => VaultFile | Promise<VaultFile>,
  ): Promise<McpSecretSummary[]> {
    const mutation = writeQueue.then(() =>
      withProcessFileLock(filePath, async () => {
        const next = await update(await vaultToChange())
        await writeVault(filePath, next)
        return summaries(next)
      }),
    )
    writeQueue = mutation.then(
      () => undefined,
      () => undefined,
    )
    return mutation
  }

  return {
    /** The secrets' names, without reading the keychain. */
    async list() {
      return summaries((await readVault()).vault)
    },
    /** Whether the vault holds `name`, without reading the keychain. */
    async has(name: string) {
      return (await readVault()).vault.secrets[validateSecretName(name)] !== undefined
    },
    async resolve(name: string) {
      await assertEncryptionAvailable(encryption)
      const normalized = validateSecretName(name)
      const { vault, shared } = await readVault()
      const entry = vault.secrets[normalized]
      const notFound = () =>
        new McpVaultError({
          reason: 'secret-not-found',
          secretName: normalized,
          message: `MCP secret ${JSON.stringify(normalized)} was not found.`,
        })
      if (!entry) throw notFound()
      try {
        return await decrypt(encryption, Buffer.from(entry.encryptedValue, 'base64'))
      } catch {
        // A shared entry this build's key does not open is another build's secret.
        if (shared) throw notFound()
        throw new McpVaultError({
          reason: 'decryption-failed',
          secretName: normalized,
          message: `MCP secret ${JSON.stringify(normalized)} cannot be decrypted for this operating-system account.`,
        })
      }
    },
    async set(name: string, value: string) {
      await assertEncryptionAvailable(encryption)
      const normalized = validateSecretName(name)
      if (value.length === 0)
        throw new McpVaultError({
          reason: 'validation',
          message: 'MCP secret values cannot be empty.',
        })
      // Sealed before the vault's lock is taken, so a slow keychain never holds the lock.
      const encryptedValue = (await encrypt(encryption, value)).toString('base64')
      return mutate((vault) => {
        const timestamp = Date.now()
        const existing = vault.secrets[normalized]
        return {
          version: 1,
          secrets: {
            ...vault.secrets,
            [normalized]: {
              encryptedValue,
              createdAt: existing?.createdAt ?? timestamp,
              updatedAt: timestamp,
            },
          },
        }
      })
    },
    async remove(name: string) {
      const normalized = validateSecretName(name)
      return mutate((vault) => {
        const nextSecrets = { ...vault.secrets }
        delete nextSecrets[normalized]
        return { version: 1, secrets: nextSecrets }
      })
    },
  }
}

let liveVault: ReturnType<typeof createEncryptedMcpSecretVault> | undefined

/** This build's vault (ADR 0032), which reads the shared one until its first save takes it over. */
function getLiveVault() {
  liveVault ??= createEncryptedMcpSecretVault(
    path.join(mcpBuildStateDirectory(), MCP_CONFIG.GLOBAL_VAULT_FILE_NAME),
    safeStorage,
    {
      legacyFilePath: path.join(sharedMcpStateDirectory(), MCP_CONFIG.GLOBAL_VAULT_FILE_NAME),
    },
  )
  return liveVault
}

/** The names in this build's vault (the shared one's until it has its own), read without decrypting. */
export async function listMcpVaultSecretNames() {
  return (await getLiveVault().list()).map((secret) => secret.name)
}

/** Whether this build's vault holds `name`, without reading the keychain. */
export function mcpVaultHasSecret(name: string) {
  return getLiveVault().has(name)
}

/** What stands for a vault secret a view only checks; its value is never shown or sent. */
const PRESENT_SECRET = 'vault-secret'

/**
 * A secret resolver for views (Settings' configuration and server states, the CLI) that only
 * report a missing secret: it checks the vault without decrypting, so a slow or prompting keychain
 * does not slow them down. A Run and a check still decrypt.
 */
export async function checkMcpVaultSecret(name: string) {
  if (await mcpVaultHasSecret(name)) return PRESENT_SECRET
  throw new McpVaultError({
    reason: 'secret-not-found',
    secretName: name,
    message: `MCP secret ${JSON.stringify(name)} was not found.`,
  })
}

/** Whether the vault every build shared before still holds `name`, whatever key sealed it. */
export async function sharedMcpVaultHasSecret(name: string) {
  const shared = await readVaultFile(
    path.join(sharedMcpStateDirectory(), MCP_CONFIG.GLOBAL_VAULT_FILE_NAME),
  ).catch(() => undefined)
  return shared?.secrets[name] !== undefined
}

/** Resolves a `{ "secret": name }` reference in OpenWaggle's MCP files before Pi sees them. */
export function resolveMcpVaultSecret(name: string) {
  return getLiveVault().resolve(name)
}

function toVaultError(error: unknown): McpVaultError {
  return error instanceof McpVaultError ? error : toMcpVaultError('io', error)
}

export const EncryptedMcpSecretVaultServiceLive = Layer.succeed(
  McpSecretVaultService,
  McpSecretVaultService.of({
    list: () => Effect.tryPromise({ try: () => getLiveVault().list(), catch: toVaultError }),
    resolve: (name) =>
      Effect.tryPromise({ try: () => getLiveVault().resolve(name), catch: toVaultError }),
    set: (input) =>
      Effect.tryPromise({
        try: () => getLiveVault().set(input.name, input.value),
        catch: toVaultError,
      }),
    remove: (input) =>
      Effect.tryPromise({ try: () => getLiveVault().remove(input.name), catch: toVaultError }),
  }),
)
