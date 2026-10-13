/** The vault file's format: parsing, reading, and atomic writes. Nothing here decrypts. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpSecretSummary } from '@shared/types/mcp'
import { isRecord } from '@shared/utils/validation'
import { McpVaultError } from '../../ports/mcp-errors'

export interface VaultEntry {
  readonly encryptedValue: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface VaultFile {
  readonly version: 1
  readonly secrets: Readonly<Record<string, VaultEntry>>
}

const VAULT_DIRECTORY_MODE = 0o700
const VAULT_FILE_MODE = 0o600

export function isEnoent(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
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

export const EMPTY_VAULT: VaultFile = { version: 1, secrets: {} }

/** The vault at `filePath`, or undefined when there is none yet. */
export async function readVaultFile(filePath: string): Promise<VaultFile | undefined> {
  try {
    return parseVault(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (isEnoent(error)) return undefined
    throw error
  }
}

export async function writeVault(filePath: string, vault: VaultFile) {
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

export function summaries(vault: VaultFile): McpSecretSummary[] {
  return Object.entries(vault.secrets)
    .map(([name, entry]) => ({ name, createdAt: entry.createdAt, updatedAt: entry.updatedAt }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
