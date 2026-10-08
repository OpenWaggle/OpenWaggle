/**
 * This build's encrypted MCP sign-in file (`oauth-states.json`): its format, decryption, atomic
 * writes, the decoded-layer cache, and taking over the store every build shared before.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isRecord } from '@shared/utils/validation'
import type { McpOAuthEncryption, McpOAuthStateBackendOptions } from './mcp-oauth-state-backend'

type States = Record<string, unknown>

export interface OwnLayer {
  states: States
  /** Keys removed in OpenWaggle while Pi's file still has them, with the hash of Pi's value. */
  tombstones: Record<string, string>
}

const STORE_VERSION = 1
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const JSON_INDENT = 2

export function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/** The store is sealed by a key this process cannot use now: another build's, or a refused keychain. */
class StoreDecryptError extends Error {}

function decryptStore(encrypted: string, encryption: McpOAuthEncryption) {
  try {
    return encryption.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (error) {
    throw new StoreDecryptError('OpenWaggle MCP sign-ins cannot be decrypted.', { cause: error })
  }
}

function decodeOwnLayer(text: string, encryption: McpOAuthEncryption): OwnLayer {
  const file: unknown = JSON.parse(text)
  if (!isRecord(file) || file.version !== STORE_VERSION || typeof file.encrypted !== 'string') {
    throw new Error('OpenWaggle MCP sign-in storage has an unsupported format.')
  }
  const layer: unknown = JSON.parse(decryptStore(file.encrypted, encryption))
  if (!isRecord(layer)) throw new Error('OpenWaggle MCP sign-in storage is invalid.')
  return {
    states: isRecord(layer.states) ? { ...layer.states } : {},
    tombstones: stringRecord(layer.tombstones),
  }
}

/**
 * A store that decrypts but cannot be parsed would make every sign-in read fail. It is moved
 * aside, kept for recovery, and the store starts empty; Pi's own sign-ins still show. Logged once:
 * the next read finds no file. A store that does not decrypt is never moved: see `readOwnLayer`.
 */
function setAsideUnreadableStore(
  storePath: string,
  error: unknown,
  warn: (message: string, context: Record<string, unknown>) => void,
): OwnLayer {
  const asidePath = `${storePath}.unreadable-${Date.now()}`
  try {
    renameSync(storePath, asidePath)
  } catch (renameError) {
    throw new Error('OpenWaggle MCP sign-in storage could not be read or moved aside.', {
      cause: renameError,
    })
  }
  warn('OpenWaggle MCP sign-ins could not be read; they were moved aside and start empty', {
    error: error instanceof Error ? error.message : String(error),
    movedTo: asidePath,
  })
  return { states: {}, tombstones: {} }
}

/** Writes the store file atomically, readable by this user only. */
function writeStoreText(storePath: string, text: string) {
  mkdirSync(path.dirname(storePath), { recursive: true, mode: DIRECTORY_MODE })
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, text, { mode: FILE_MODE })
    renameSync(temporaryPath, storePath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

/** The shared pre-build store, with its decoded layer, when this build can open it. */
function readLegacyStore(
  legacyStorePath: string,
  encryption: McpOAuthEncryption,
  warn: (message: string, context: Record<string, unknown>) => void,
): { readonly text: string; readonly layer: OwnLayer } | undefined {
  try {
    const text = readFileSync(legacyStorePath, 'utf8')
    return { text, layer: decodeOwnLayer(text, encryption) }
  } catch (error) {
    if (!isMissing(error)) {
      warn('The shared MCP sign-in store is not this build’s; it was left in place', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return undefined
  }
}

function fileVersion(filePath: string) {
  const stat = statSync(filePath)
  return `${stat.ino}:${stat.size}:${stat.mtimeMs}`
}

/**
 * This build's encrypted layer on disk. A Pi token read asks for it on every MCP request, so the
 * decoded layer is kept while the file is unchanged (same inode, size, and mtime) and decrypted
 * again only after a write, here or in another process.
 */
export class OwnLayerFile {
  private cached: { readonly version: string; readonly layer: OwnLayer } | undefined
  private legacyChecked = false

  constructor(
    private readonly options: McpOAuthStateBackendOptions,
    private readonly warn: (message: string, context: Record<string, unknown>) => void,
  ) {}

  /** The layer, or undefined while it cannot be decrypted (left untouched until then). */
  read(): OwnLayer | undefined {
    let version: string
    try {
      version = fileVersion(this.options.storePath)
    } catch (error) {
      if (!isMissing(error)) throw error
      return this.takeLegacyStore()
    }
    if (this.cached?.version === version) return structuredClone(this.cached.layer)
    const text = readFileSync(this.options.storePath, 'utf8')
    try {
      const layer = decodeOwnLayer(text, this.options.encryption)
      this.cached = { version, layer: structuredClone(layer) }
      return layer
    } catch (error) {
      if (error instanceof StoreDecryptError) return undefined
      return setAsideUnreadableStore(this.options.storePath, error, this.warn)
    }
  }

  write(layer: OwnLayer) {
    const encrypted = this.options.encryption
      .encryptString(JSON.stringify(layer))
      .toString('base64')
    writeStoreText(
      this.options.storePath,
      `${JSON.stringify({ version: STORE_VERSION, encrypted }, null, JSON_INDENT)}\n`,
    )
    this.cached = { version: fileVersion(this.options.storePath), layer: structuredClone(layer) }
  }

  /** Checked once per process: a store this build cannot open stays the other build's. */
  private takeLegacyStore(): OwnLayer {
    const { legacyStorePath } = this.options
    const legacy =
      this.legacyChecked || !legacyStorePath
        ? undefined
        : readLegacyStore(legacyStorePath, this.options.encryption, this.warn)
    this.legacyChecked = true
    if (legacy) writeStoreText(this.options.storePath, legacy.text)
    return legacy?.layer ?? { states: {}, tombstones: {} }
  }
}
