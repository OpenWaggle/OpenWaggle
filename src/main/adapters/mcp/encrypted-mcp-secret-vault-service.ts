import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpSecretSummary } from '@shared/types/mcp'
import { isRecord } from '@shared/utils/validation'
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
import { withProcessFileLock } from './process-file-lock'

interface VaultEntry {
  readonly encryptedValue: string
  readonly createdAt: number
  readonly updatedAt: number
}

interface VaultFile {
  readonly version: 1
  readonly secrets: Readonly<Record<string, VaultEntry>>
}

const VAULT_DIRECTORY_MODE = 0o700
const VAULT_FILE_MODE = 0o600

function isEnoent(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

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

function parseVaultEntry(name: string, value: unknown): VaultEntry {
  if (!isRecord(value)) {
    throw new McpVaultError({
      reason: 'io',
      message: `OpenWaggle MCP vault entry ${JSON.stringify(name)} is invalid.`,
    })
  }
  const { encryptedValue, createdAt, updatedAt } = value
  if (
    typeof encryptedValue !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number'
  ) {
    throw new McpVaultError({
      reason: 'io',
      message: `OpenWaggle MCP vault entry ${JSON.stringify(name)} is invalid.`,
    })
  }
  return { encryptedValue, createdAt, updatedAt }
}

function parseVault(raw: string): VaultFile {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new McpVaultError({
      reason: 'io',
      message: 'OpenWaggle MCP vault has an unsupported format.',
    })
  }
  if (!isRecord(parsed.secrets)) {
    throw new McpVaultError({
      reason: 'io',
      message: 'OpenWaggle MCP vault is missing its encrypted secret map.',
    })
  }
  const secrets: Record<string, VaultEntry> = {}
  for (const [name, value] of Object.entries(parsed.secrets)) {
    secrets[name] = parseVaultEntry(name, value)
  }
  return { version: 1, secrets }
}

const EMPTY_VAULT: VaultFile = { version: 1, secrets: {} }

/** The vault at `filePath`, or undefined when there is none yet. */
async function readVaultFile(filePath: string): Promise<VaultFile | undefined> {
  try {
    return parseVault(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (isEnoent(error)) return undefined
    throw error
  }
}

async function decryptsWith(encryption: McpVaultEncryption, entry: VaultEntry) {
  try {
    await decrypt(encryption, Buffer.from(entry.encryptedValue, 'base64'))
    return true
  } catch {
    return false
  }
}

/** The entries of the shared pre-build vault this build's key opens; the others are another build's. */
async function ownLegacySecrets(legacyFilePath: string, encryption: McpVaultEncryption) {
  const legacy = await readVaultFile(legacyFilePath).catch(() => undefined)
  if (!legacy || !(await encryptionAvailable(encryption))) return undefined
  const entries = Object.entries(legacy.secrets)
  const opens = await Promise.all(entries.map(([, entry]) => decryptsWith(encryption, entry)))
  const secrets = Object.fromEntries(entries.filter((_, index) => opens[index]))
  return Object.keys(secrets).length > 0 ? { version: 1 as const, secrets } : undefined
}

async function writeVault(filePath: string, vault: VaultFile) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: VAULT_DIRECTORY_MODE })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(vault, null, MCP_CONFIG.JSON_INDENT_SPACES)}\n`,
      { mode: VAULT_FILE_MODE },
    )
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function summaries(vault: VaultFile): McpSecretSummary[] {
  return Object.entries(vault.secrets)
    .map(([name, entry]) => ({ name, createdAt: entry.createdAt, updatedAt: entry.updatedAt }))
    .sort((left, right) => left.name.localeCompare(right.name))
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
   * The vault every build shared before it moved to user data. While this build has no vault,
   * the secrets this build can decrypt are copied from it once; it is never changed.
   */
  readonly legacyFilePath?: string
}

export function createEncryptedMcpSecretVault(
  filePath: string,
  encryption: McpVaultEncryption = safeStorage,
  options: EncryptedMcpSecretVaultOptions = {},
) {
  let writeQueue: Promise<void> = Promise.resolve()
  let legacyChecked = false

  /** This build's vault; the first time it has none, what it can take from the shared one. */
  async function readVault(vaultFile: string, locked = false): Promise<VaultFile> {
    const own = await readVaultFile(vaultFile)
    if (own) return own
    if (legacyChecked || !options.legacyFilePath) return EMPTY_VAULT
    legacyChecked = true
    const taken = await ownLegacySecrets(options.legacyFilePath, encryption)
    if (!taken) return EMPTY_VAULT
    const save = async () => {
      if (!(await readVaultFile(vaultFile))) await writeVault(vaultFile, taken)
    }
    await (locked ? save() : withProcessFileLock(vaultFile, save))
    return (await readVaultFile(vaultFile)) ?? taken
  }

  async function mutate(
    update: (vault: VaultFile) => VaultFile | Promise<VaultFile>,
  ): Promise<McpSecretSummary[]> {
    const mutation = writeQueue.then(() =>
      withProcessFileLock(filePath, async () => {
        const next = await update(await readVault(filePath, true))
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
    async list() {
      return summaries(await readVault(filePath))
    },
    /** Whether the vault holds `name`, without reading the keychain. */
    async has(name: string) {
      // A first read may take over the shared vault's secrets, asynchronously; resolving none.
      return (await readVault(filePath)).secrets[validateSecretName(name)] !== undefined
    },
    async resolve(name: string) {
      await assertEncryptionAvailable(encryption)
      const normalized = validateSecretName(name)
      const entry = (await readVault(filePath)).secrets[normalized]
      if (!entry)
        throw new McpVaultError({
          reason: 'secret-not-found',
          secretName: normalized,
          message: `MCP secret ${JSON.stringify(normalized)} was not found.`,
        })
      try {
        return await decrypt(encryption, Buffer.from(entry.encryptedValue, 'base64'))
      } catch {
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

/** This build's vault (ADR 0032), which took over its own secrets from the shared one. */
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

/** The names in this build's vault, after it took over its own secrets from the shared one. */
export async function listMcpVaultSecretNames() {
  return (await getLiveVault().list()).map((secret) => secret.name)
}

/** Whether this build's vault holds `name`, without reading the keychain. */
export function mcpVaultHasSecret(name: string) {
  return getLiveVault().has(name)
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
