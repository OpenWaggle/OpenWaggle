import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { isRecord } from '@shared/utils/validation'
import { withProcessFileLockSync } from '../process-file-lock'
import { isMissing, type OwnLayer, OwnLayerFile } from './mcp-oauth-store-file'

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
  /** Whether a write reaches the encrypted file; without encryption it lasts until the Host stops. */
  persistsWrites(): boolean
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
  /** How long a write waits for another process holding the store's lock. */
  readonly lockWaitMs?: number
  readonly onWarning?: (message: string, context: Record<string, unknown>) => void
}

type States = Record<string, unknown>

function hashValue(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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

/** Pi's states that are not hidden by a tombstone still matching them. */
function visiblePiStates(pi: States, layer: OwnLayer) {
  return Object.fromEntries(
    Object.entries(pi).filter(([key, value]) => layer.tombstones[key] !== hashValue(value)),
  )
}

/** Applies what changed between `merged` (what the caller read) and `next` to `layer`. */
function applyChanges(pi: States, layer: OwnLayer, merged: States, next: string) {
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
}

export function createMcpOAuthStateBackend(
  options: McpOAuthStateBackendOptions,
): McpOAuthStorageBackend {
  let memoryLayer: OwnLayer | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const warn = (message: string, context: Record<string, unknown>) =>
    options.onWarning?.(message, context)
  const file = new OwnLayerFile(options, warn)

  function readOwnLayer(): OwnLayer | undefined {
    if (options.encryption.isEncryptionAvailable()) return file.read()
    memoryLayer ??= { states: {}, tombstones: {} }
    return memoryLayer
  }

  /**
   * Saves what the caller changed. Under the store's cross-process lock, the layer is read again
   * and only the changes are applied, so a sign-in another process saved meanwhile is kept.
   */
  function commit(pi: States, merged: States, next: string) {
    if (!options.encryption.isEncryptionAvailable()) {
      warn('Operating-system encryption is unavailable; MCP sign-ins last until the Host stops', {})
      memoryLayer ??= { states: {}, tombstones: {} }
      applyChanges(pi, memoryLayer, merged, next)
      return
    }
    withProcessFileLockSync(
      options.storePath,
      () => {
        const layer = file.read()
        // Writing now would replace sign-ins this process cannot read.
        if (!layer) {
          throw new Error(
            'OpenWaggle MCP sign-ins cannot be decrypted right now, so this change was not saved.',
          )
        }
        applyChanges(pi, layer, merged, next)
        file.write(layer)
      },
      options.lockWaitMs,
    )
  }

  function snapshot() {
    const pi = readPiStates(options.piAuthPath, warn)
    const own = readOwnLayer() ?? { states: {}, tombstones: {} }
    const merged = { ...visiblePiStates(pi, own), ...own.states }
    const current = Object.keys(merged).length > 0 ? JSON.stringify(merged) : undefined
    return { pi, merged, current }
  }

  return {
    withLock(fn) {
      const { pi, merged, current } = snapshot()
      const { result, next } = fn(current)
      if (next !== undefined) commit(pi, merged, next)
      return result
    },
    withLockAsync<T>(fn: (current: string | undefined) => Promise<{ result: T; next?: string }>) {
      const operation = queue.then(async () => {
        const { pi, merged, current } = snapshot()
        const { result, next } = await fn(current)
        if (next !== undefined) commit(pi, merged, next)
        return result
      })
      queue = operation.catch(() => undefined)
      return operation
    },
    persistsWrites: () => options.encryption.isEncryptionAvailable(),
  }
}
