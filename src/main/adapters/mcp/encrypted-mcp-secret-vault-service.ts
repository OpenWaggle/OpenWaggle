import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpSecretSummary } from '@shared/types/mcp'
import { Effect, Layer } from 'effect'
import { safeStorage } from 'electron'
import { McpVaultError, toMcpVaultError } from '../../ports/mcp-errors'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

async function readVault(filePath: string): Promise<VaultFile> {
  try {
    return parseVault(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (isEnoent(error)) return { version: 1, secrets: {} }
    throw error
  }
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

interface McpVaultEncryption {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (value: string) => Buffer
  readonly decryptString: (value: Buffer) => string
}

function assertEncryptionAvailable(encryption: McpVaultEncryption) {
  if (!encryption.isEncryptionAvailable()) {
    throw new McpVaultError({
      reason: 'encryption-unavailable',
      message:
        'Operating-system encryption is unavailable, so OpenWaggle will not read or write MCP secrets.',
    })
  }
}

export function createEncryptedMcpSecretVault(
  filePath: string,
  encryption: McpVaultEncryption = safeStorage,
) {
  let writeQueue: Promise<void> = Promise.resolve()

  async function mutate(
    update: (vault: VaultFile) => VaultFile | Promise<VaultFile>,
  ): Promise<McpSecretSummary[]> {
    const mutation = writeQueue.then(() =>
      withProcessFileLock(filePath, async () => {
        const next = await update(await readVault(filePath))
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
    async resolve(name: string) {
      assertEncryptionAvailable(encryption)
      const normalized = validateSecretName(name)
      const entry = (await readVault(filePath)).secrets[normalized]
      if (!entry)
        throw new McpVaultError({
          reason: 'secret-not-found',
          secretName: normalized,
          message: `MCP secret ${JSON.stringify(normalized)} was not found.`,
        })
      try {
        return encryption.decryptString(Buffer.from(entry.encryptedValue, 'base64'))
      } catch {
        throw new McpVaultError({
          reason: 'decryption-failed',
          secretName: normalized,
          message: `MCP secret ${JSON.stringify(normalized)} cannot be decrypted for this operating-system account.`,
        })
      }
    },
    async set(name: string, value: string) {
      assertEncryptionAvailable(encryption)
      const normalized = validateSecretName(name)
      if (value.length === 0)
        throw new McpVaultError({
          reason: 'validation',
          message: 'MCP secret values cannot be empty.',
        })
      return mutate((vault) => {
        const timestamp = Date.now()
        const existing = vault.secrets[normalized]
        return {
          version: 1,
          secrets: {
            ...vault.secrets,
            [normalized]: {
              encryptedValue: encryption.encryptString(value).toString('base64'),
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

const vaultPath = path.join(
  homedir(),
  ...MCP_CONFIG.GLOBAL_STATE_DIR,
  MCP_CONFIG.GLOBAL_VAULT_FILE_NAME,
)
let liveVault: ReturnType<typeof createEncryptedMcpSecretVault> | undefined

function getLiveVault() {
  liveVault ??= createEncryptedMcpSecretVault(vaultPath)
  return liveVault
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
