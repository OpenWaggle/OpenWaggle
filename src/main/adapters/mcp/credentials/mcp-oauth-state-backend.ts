import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isRecord } from '@shared/utils/validation'

/**
 * Storage for Pi's MCP OAuth state (`McpOAuthCredentialStore`), keyed as Pi keys it
 * (`<mcpNamespace(name)>|<url>`).
 *
 * Reads merge two layers: Pi's `mcp-auth.json`, read-only, and OpenWaggle's encrypted store, which
 * wins per key. Writes go to the encrypted store only. Removing a key that only Pi's file has
 * records a tombstone with the hash of Pi's value, which hides it until Pi's file changes it (a
 * sign-in in the `pi` CLI), so OpenWaggle never edits Pi's file and a later Pi sign-in still shows.
 */

/** Pi's `AuthStorageBackend`, declared structurally. */
export interface McpOAuthStorageBackend {
  withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T
  withLockAsync<T>(
    fn: (current: string | undefined) => Promise<{ result: T; next?: string }>,
  ): Promise<T>
}

export interface McpOAuthEncryption {
  readonly isEncryptionAvailable: () => boolean
  readonly encryptString: (value: string) => Buffer
  readonly decryptString: (value: Buffer) => string
}

export interface McpOAuthStateBackendOptions {
  /** Pi's `~/.pi/agent/mcp-auth.json`. */
  readonly piAuthPath: string
  /** OpenWaggle's encrypted store, in this build's user data: each build has its own key. */
  readonly storePath: string
  /**
   * The store every build shared before it moved to user data. Copied over once when this build
   * can decrypt it, and never changed: another build may still need its own copy.
   */
  readonly legacyStorePath?: string
  readonly encryption: McpOAuthEncryption
  readonly onWarning?: (message: string, context: Record<string, unknown>) => void
}

type States = Record<string, unknown>

interface OwnLayer {
  states: States
  /** Keys removed in OpenWaggle while Pi's file still has them, with the hash of Pi's value. */
  tombstones: Record<string, string>
}

const STORE_VERSION = 1
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700
const JSON_INDENT = 2

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function hashValue(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function readPiStates(
  piAuthPath: string,
  warn: (message: string, context: Record<string, unknown>) => void,
): States {
  let text: string
  try {
    text = readFileSync(piAuthPath, 'utf8')
  } catch (error) {
    if (!isMissing(error)) warn('Could not read Pi MCP credentials', { error: String(error) })
    return {}
  }
  if (!text.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    warn('Pi MCP credentials are not valid JSON', { error: String(error) })
    return {}
  }
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

export function createMcpOAuthStateBackend(
  options: McpOAuthStateBackendOptions,
): McpOAuthStorageBackend {
  let memoryLayer: OwnLayer | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let legacyChecked = false

  const warn = (message: string, context: Record<string, unknown>) =>
    options.onWarning?.(message, context)

  /** This build's layer, or undefined while it cannot be decrypted (left untouched until then). */
  function readOwnLayer(): OwnLayer | undefined {
    if (!options.encryption.isEncryptionAvailable()) {
      memoryLayer ??= { states: {}, tombstones: {} }
      return memoryLayer
    }
    let text: string
    try {
      text = readFileSync(options.storePath, 'utf8')
    } catch (error) {
      if (!isMissing(error)) throw error
      // Checked once per process: a store this build cannot open stays the other build's.
      const legacy =
        legacyChecked || !options.legacyStorePath
          ? undefined
          : readLegacyStore(options.legacyStorePath, options.encryption, warn)
      legacyChecked = true
      if (legacy) writeStoreText(options.storePath, legacy.text)
      return legacy?.layer ?? { states: {}, tombstones: {} }
    }
    try {
      return decodeOwnLayer(text, options.encryption)
    } catch (error) {
      if (error instanceof StoreDecryptError) return undefined
      return setAsideUnreadableStore(options.storePath, error, warn)
    }
  }

  function writeOwnLayer(layer: OwnLayer) {
    if (!options.encryption.isEncryptionAvailable()) {
      warn('Operating-system encryption is unavailable; MCP sign-ins last until the Host stops', {})
      memoryLayer = layer
      return
    }
    const encrypted = options.encryption.encryptString(JSON.stringify(layer)).toString('base64')
    writeStoreText(
      options.storePath,
      `${JSON.stringify({ version: STORE_VERSION, encrypted }, null, JSON_INDENT)}\n`,
    )
  }

  /** Pi's states that are not hidden by a tombstone still matching them. */
  function visiblePiStates(pi: States, layer: OwnLayer) {
    return Object.fromEntries(
      Object.entries(pi).filter(([key, value]) => layer.tombstones[key] !== hashValue(value)),
    )
  }

  function applyNext(pi: States, layer: OwnLayer | undefined, merged: States, next: string) {
    // Writing now would replace sign-ins this process cannot read.
    if (!layer) {
      throw new Error(
        'OpenWaggle MCP sign-ins cannot be decrypted right now, so this change was not saved.',
      )
    }
    const parsed: unknown = JSON.parse(next)
    const nextStates: States = isRecord(parsed) ? parsed : {}
    const visible = visiblePiStates(pi, layer)
    for (const [key, value] of Object.entries(nextStates)) {
      if (isDeepStrictEqual(value, merged[key])) continue
      layer.states[key] = value
      delete layer.tombstones[key]
    }
    for (const key of Object.keys(merged)) {
      if (key in nextStates) continue
      delete layer.states[key]
      if (key in visible) layer.tombstones[key] = hashValue(visible[key])
    }
    // A tombstone whose Pi value changed or disappeared no longer hides anything.
    for (const [key, hash] of Object.entries(layer.tombstones)) {
      if (!(key in pi) || hashValue(pi[key]) !== hash) delete layer.tombstones[key]
    }
    writeOwnLayer(layer)
  }

  function snapshot() {
    const pi = readPiStates(options.piAuthPath, warn)
    const layer = readOwnLayer()
    const own = layer ?? { states: {}, tombstones: {} }
    const merged = { ...visiblePiStates(pi, own), ...own.states }
    const current = Object.keys(merged).length > 0 ? JSON.stringify(merged) : undefined
    return { pi, layer, merged, current }
  }

  return {
    withLock(fn) {
      const { pi, layer, merged, current } = snapshot()
      const { result, next } = fn(current)
      if (next !== undefined) applyNext(pi, layer, merged, next)
      return result
    },
    withLockAsync<T>(fn: (current: string | undefined) => Promise<{ result: T; next?: string }>) {
      const operation = queue.then(async () => {
        const { pi, layer, merged, current } = snapshot()
        const { result, next } = await fn(current)
        if (next !== undefined) applyNext(pi, layer, merged, next)
        return result
      })
      queue = operation.catch(() => undefined)
      return operation
    },
  }
}
