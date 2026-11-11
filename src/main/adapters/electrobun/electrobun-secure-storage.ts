import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getDesktopHelperChildEnv } from '../../env'
import {
  decodeKey,
  newEncodedKey,
  openWithKey,
  sealWithKey,
} from '../../electron-migration/keychain-sealer'
import type { SecureStorageShape } from '../../ports/desktop-shell/secure-storage'
import { withProcessFileLockSync } from '../mcp/process-file-lock'
import { electrobunBootShell } from './electrobun-boot-shell'

/**
 * SecureStorage on `Bun.secrets` (ADR 0064): one random AES-256-GCM key per build lives in the OS
 * keychain (macOS Keychain, Windows Credential Manager, the Secret Service), and each secret is
 * sealed with it in the `ow1` format the Electron migration writes (`keychain-sealer.ts`), so a
 * migrated secret and a new one are the same kind of blob.
 *
 * The port is synchronous, as `safeStorage` was, and `Bun.secrets` is not: the key is read once
 * per process by a short `bun -e` child the process waits for (the same signed `bun`, so the
 * keychain sees the same identity), then kept in memory. A process that knows it will need it calls
 * `warmElectrobunSecureStorage()` at startup to read it in-process instead. Cost: one child start
 * (0.2 to 0.4 s on an M-series Mac) the first time an unwarmed process uses a secret; a keychain prompt blocks the caller until it is answered or
 * `KEY_READ_TIMEOUT_MS` passes, exactly as `safeStorage`'s synchronous calls blocked before.
 */
const SERVICE = 'OpenWaggle Secret Storage'
const KEY_READ_TIMEOUT_MS = 20_000
/** After a failed read, how long `isEncryptionAvailable` answers false before asking again. */
const UNAVAILABLE_RETRY_MS = 30_000
const KEY_LOCK_FILE = 'secret-storage-key'

/** Runs in the child: prints the stored key, creating it first when asked and missing. */
const KEY_SCRIPT = [
  'const { service, name, create } = JSON.parse(await Bun.stdin.text())',
  'let value = await Bun.secrets.get({ service, name })',
  'if (value === null && create !== null) {',
  '  await Bun.secrets.set({ service, name, value: create })',
  '  value = await Bun.secrets.get({ service, name })',
  '}',
  "process.stdout.write(value ?? '')",
].join('\n')

/** The keychain item that holds this build's key: read it, or create it with `create`. */
export type KeychainKeyStore = (item: {
  readonly service: string
  readonly name: string
  readonly create: string | null
}) => string | null

function bunSecretsKeyStore(): KeychainKeyStore {
  return (item) => {
    const value = execFileSync(process.execPath, ['-e', KEY_SCRIPT], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: getDesktopHelperChildEnv(),
      input: JSON.stringify(item),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: KEY_READ_TIMEOUT_MS,
      windowsHide: true,
    })
    return value.length > 0 ? value : null
  }
}

/** `Bun.secrets.get`'s shape, for the in-process read. */
export type KeychainKeyReader = (item: {
  readonly service: string
  readonly name: string
}) => Promise<string | null>

export interface KeychainSecureStorage extends SecureStorageShape {
  /** Reads an existing key in-process, so the first secret needs no child; never creates one. */
  readonly warm: () => Promise<void>
}

export interface KeychainSecureStorageOptions {
  readonly store: KeychainKeyStore
  readonly read?: KeychainKeyReader
  /** The account of the keychain item; builds with another userData keep their own key. */
  readonly name: () => string
  /** Serializes key creation across the desktop app, the Session Host and the CLI. */
  readonly withCreationLock: <T>(operation: () => T) => T
  readonly now?: () => number
}

export function createKeychainSecureStorage(
  options: KeychainSecureStorageOptions,
): KeychainSecureStorage {
  const state: { key: Buffer | null; failedAt: number | null } = { key: null, failedAt: null }
  const now = options.now ?? Date.now

  function loadKey() {
    const item = { service: SERVICE, name: options.name() }
    const stored = options.store({ ...item, create: null })
    if (stored !== null) return decodeKey(stored)
    return options.withCreationLock(() => {
      const created = options.store({ ...item, create: newEncodedKey() })
      if (created === null) throw new Error('The keychain did not keep the secret-storage key.')
      return decodeKey(created)
    })
  }

  function key() {
    if (state.key) return state.key
    try {
      state.key = loadKey()
      state.failedAt = null
      return state.key
    } catch (error) {
      state.failedAt = now()
      throw new Error('The system keychain is unavailable, so the secret cannot be stored.', {
        cause: error,
      })
    }
  }

  return {
    isEncryptionAvailable: () => {
      if (state.key) return true
      if (state.failedAt !== null && now() - state.failedAt < UNAVAILABLE_RETRY_MS) return false
      try {
        key()
        return true
      } catch {
        return false
      }
    },
    encryptString: (plainText) => sealWithKey(key(), plainText),
    decryptString: (encrypted) => openWithKey(key(), encrypted),
    warm: async () => {
      if (state.key || !options.read) return
      const stored = await options
        .read({ service: SERVICE, name: options.name() })
        .catch(() => null)
      if (stored !== null && !state.key) state.key = decodeKey(stored)
    },
  }
}

interface BunSecretsGlobal {
  readonly secrets: { readonly get: KeychainKeyReader }
}

function isBunSecretsGlobal(value: unknown): value is BunSecretsGlobal {
  const secrets: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'secrets') : null
  return (
    typeof secrets === 'object' &&
    secrets !== null &&
    typeof Reflect.get(secrets, 'get') === 'function'
  )
}

/** `Bun.secrets.get` of this process, absent outside Bun. */
function inProcessKeyReader(): KeychainKeyReader | undefined {
  const bun: unknown = Reflect.get(globalThis, 'Bun')
  if (!isBunSecretsGlobal(bun)) return undefined
  return (item) => bun.secrets.get(item)
}

const inProcessRead = inProcessKeyReader()

export const electrobunSecureStorage = createKeychainSecureStorage({
  store: bunSecretsKeyStore(),
  ...(inProcessRead ? { read: inProcessRead } : {}),
  name: () => path.basename(electrobunBootShell.userData()),
  withCreationLock: (operation) =>
    withProcessFileLockSync(
      path.join(electrobunBootShell.userData(), KEY_LOCK_FILE),
      operation,
      KEY_READ_TIMEOUT_MS,
    ),
})

/** Reads this build's key in-process at startup of a process that will open secrets. */
export function warmElectrobunSecureStorage() {
  return electrobunSecureStorage.warm()
}
