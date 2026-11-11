/**
 * Decrypts what Electron's `safeStorage.encryptString` sealed, without Electron, so the first
 * Electrobun launch can re-seal it. The formats are Chromium OSCrypt's:
 * - macOS `v10`: AES-128-CBC, key PBKDF2-SHA1(keychain password, "saltysalt", 1003), IV of spaces.
 *   The password is the login keychain item `<app name> Safe Storage`, account `<app name> Key`
 *   (what Electron 42 and 43 release builds use), or account `<app name>` (older dev builds).
 * - Linux `v10`: the same cipher keyed by PBKDF2-SHA1("peanuts", 1): Electron's `basic_text` store.
 * - Linux `v11`: keyed by the Secret Service (libsecret) or KWallet password, 1 iteration; Chromium
 *   also falls back to an empty password when the keyring answered with nothing.
 * - Windows `v10`: AES-256-GCM (12-byte nonce, 16-byte tag) keyed by `os_crypt.encrypted_key` from
 *   `Local State`, itself DPAPI-protected for the current user. Blobs without a prefix are older
 *   raw DPAPI blobs.
 */
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'

const PREFIX_BYTES = 3
const V10 = 'v10'
const V11 = 'v11'
const KEY_SALT = 'saltysalt'
const CBC_KEY_BYTES = 16
const CBC_IV = Buffer.alloc(CBC_KEY_BYTES, ' ')
const MAC_ITERATIONS = 1003
const LINUX_ITERATIONS = 1
const LINUX_BASIC_TEXT_PASSWORD = 'peanuts'
const GCM_KEY_BYTES = 32
const GCM_NONCE_BYTES = 12
const GCM_TAG_BYTES = 16
const LOCAL_STATE_DPAPI_PREFIX = Buffer.from('DPAPI')
/** Every DPAPI blob starts with version 1 and the DPAPI provider GUID. */
const DPAPI_BLOB_HEADER = Buffer.from('01000000d08c9ddf0115d1118c7a00c04fc297eb', 'hex')

export type ElectronSafeStoragePlatform = 'darwin' | 'linux' | 'win32'

export type SafeStorageFailureReason =
  /** The OS key store refused, timed out, or has no key for this app. */
  | 'key-unavailable'
  /** A key was found but does not open this blob. */
  | 'wrong-key'
  | 'unknown-format'

export class SafeStorageDecryptError extends Error {
  readonly reason: SafeStorageFailureReason

  constructor(reason: SafeStorageFailureReason, message: string, options?: ErrorOptions) {
    super(message, options)
    this.reason = reason
  }
}

/** Where the old keys live. Every reader may be slow or prompt; each is called at most once. */
export interface ElectronSafeStorageKeySources {
  readonly platform: ElectronSafeStoragePlatform
  /** Electron's `app.getName()` for the install: `openwaggle` for every release channel. */
  readonly appName: string
  /** macOS: the generic-password secret, or null when there is no such item. */
  readonly readKeychainPassword?: (service: string, account: string) => Promise<string | null>
  /** Linux: the os_crypt password from the Secret Service or KWallet, or null when absent. */
  readonly readLinuxKeyringPassword?: (application: string) => Promise<string | null>
  /** Windows: every candidate `Local State` text, newest location first. */
  readonly readWindowsLocalStates?: () => Promise<readonly string[]>
  /** Windows: `CryptUnprotectData` for the current user. */
  readonly unprotectDpapi?: (data: Buffer) => Promise<Buffer>
}

export function deriveCbcKey(password: string, iterations: number) {
  return pbkdf2Sync(password, KEY_SALT, iterations, CBC_KEY_BYTES, 'sha1')
}

function decryptCbc(key: Buffer, body: Buffer) {
  const decipher = createDecipheriv('aes-128-cbc', key, CBC_IV)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

function decryptGcm(key: Buffer, body: Buffer) {
  if (body.length < GCM_NONCE_BYTES + GCM_TAG_BYTES) {
    throw new SafeStorageDecryptError('unknown-format', 'The Windows secret is truncated.')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, body.subarray(0, GCM_NONCE_BYTES))
  decipher.setAuthTag(body.subarray(body.length - GCM_TAG_BYTES))
  return Buffer.concat([
    decipher.update(body.subarray(GCM_NONCE_BYTES, body.length - GCM_TAG_BYTES)),
    decipher.final(),
  ])
}

/** Tries each key; the CBC padding or the GCM tag tells a wrong key from the right one. */
function decryptWithAny(keys: readonly Buffer[], body: Buffer, decrypt: typeof decryptCbc) {
  for (const key of keys) {
    try {
      return decrypt(key, body).toString('utf8')
    } catch {
      // The next candidate key; a wrong one fails its padding or tag check.
    }
  }
  throw new SafeStorageDecryptError(
    'wrong-key',
    'No key from the previous install opens this secret.',
  )
}

function once<T>(read: () => Promise<T>) {
  let pending: Promise<T> | undefined
  return () => {
    pending ??= read()
    return pending
  }
}

function unavailable(message: string, cause?: unknown) {
  return new SafeStorageDecryptError('key-unavailable', message, { cause })
}

export function windowsWrappedKey(localState: string) {
  const state: unknown = JSON.parse(localState)
  if (typeof state !== 'object' || state === null || !('os_crypt' in state)) return undefined
  const osCrypt = state.os_crypt
  if (typeof osCrypt !== 'object' || osCrypt === null || !('encrypted_key' in osCrypt)) return
  if (typeof osCrypt.encrypted_key !== 'string') return undefined
  const wrapped = Buffer.from(osCrypt.encrypted_key, 'base64')
  if (!wrapped.subarray(0, LOCAL_STATE_DPAPI_PREFIX.length).equals(LOCAL_STATE_DPAPI_PREFIX)) return
  return wrapped.subarray(LOCAL_STATE_DPAPI_PREFIX.length)
}

function macKeys(sources: ElectronSafeStorageKeySources) {
  return once(async () => {
    const read = sources.readKeychainPassword
    if (!read) throw unavailable('No macOS keychain reader was provided.')
    const service = `${sources.appName} Safe Storage`
    let password: string | null
    try {
      // A missing item never prompts, so trying the older account name costs nothing.
      password =
        (await read(service, `${sources.appName} Key`)) ?? (await read(service, sources.appName))
    } catch (cause) {
      throw unavailable(`The login keychain did not provide "${service}".`, cause)
    }
    if (password === null || password.length === 0) {
      throw unavailable(`The login keychain has no "${service}" item.`)
    }
    return [deriveCbcKey(password, MAC_ITERATIONS)]
  })
}

function linuxKeyringKeys(sources: ElectronSafeStorageKeySources) {
  return once(async () => {
    const empty = deriveCbcKey('', LINUX_ITERATIONS)
    const read = sources.readLinuxKeyringPassword
    if (!read) return { keys: [empty], error: unavailable('No Linux keyring reader was provided.') }
    try {
      const password = await read(sources.appName)
      if (password === null || password.length === 0) {
        return { keys: [empty], error: unavailable('The desktop keyring has no OpenWaggle key.') }
      }
      return { keys: [deriveCbcKey(password, LINUX_ITERATIONS), empty], error: undefined }
    } catch (cause) {
      return { keys: [empty], error: unavailable('The desktop keyring did not answer.', cause) }
    }
  })
}

function windowsKeys(sources: ElectronSafeStorageKeySources) {
  return once(async () => {
    const { readWindowsLocalStates, unprotectDpapi } = sources
    if (!readWindowsLocalStates || !unprotectDpapi) {
      throw unavailable('No Windows Local State or DPAPI reader was provided.')
    }
    const keys: Buffer[] = []
    let lastError: unknown
    for (const localState of await readWindowsLocalStates()) {
      try {
        const wrapped = windowsWrappedKey(localState)
        if (!wrapped) continue
        const key = await unprotectDpapi(wrapped)
        if (key.length === GCM_KEY_BYTES) keys.push(key)
      } catch (cause) {
        lastError = cause
      }
    }
    if (keys.length === 0) throw unavailable('No Local State key could be unwrapped.', lastError)
    return keys
  })
}

export type ElectronSafeStorageFormat =
  | 'mac-v10'
  | 'linux-v10'
  | 'linux-v11'
  | 'windows-v10'
  | 'windows-dpapi'
  | 'unknown'

export function electronSafeStorageFormat(
  platform: ElectronSafeStoragePlatform,
  blob: Buffer,
): ElectronSafeStorageFormat {
  const prefix = blob.subarray(0, PREFIX_BYTES).toString('latin1')
  if (platform === 'darwin') return prefix === V10 ? 'mac-v10' : 'unknown'
  if (platform === 'linux') {
    if (prefix === V10) return 'linux-v10'
    return prefix === V11 ? 'linux-v11' : 'unknown'
  }
  if (prefix === V10) return 'windows-v10'
  return blob.subarray(0, DPAPI_BLOB_HEADER.length).equals(DPAPI_BLOB_HEADER)
    ? 'windows-dpapi'
    : 'unknown'
}

/** A reader of the previous install's secrets. Keys are fetched on first need, then reused. */
export function createElectronSafeStorageReader(sources: ElectronSafeStorageKeySources) {
  const mac = macKeys(sources)
  const linux = linuxKeyringKeys(sources)
  const windows = windowsKeys(sources)
  const basicText = deriveCbcKey(LINUX_BASIC_TEXT_PASSWORD, LINUX_ITERATIONS)

  async function decrypt(blob: Buffer): Promise<string> {
    const format = electronSafeStorageFormat(sources.platform, blob)
    const body = blob.subarray(PREFIX_BYTES)
    if (format === 'mac-v10') return decryptWithAny(await mac(), body, decryptCbc)
    if (format === 'linux-v10') return decryptWithAny([basicText], body, decryptCbc)
    if (format === 'linux-v11') {
      const { keys, error } = await linux()
      try {
        return decryptWithAny(keys, body, decryptCbc)
      } catch (wrongKey) {
        throw error ?? wrongKey
      }
    }
    if (format === 'windows-v10') return decryptWithAny(await windows(), body, decryptGcm)
    if (format === 'windows-dpapi' && sources.unprotectDpapi) {
      try {
        return (await sources.unprotectDpapi(blob)).toString('utf8')
      } catch (cause) {
        throw new SafeStorageDecryptError('wrong-key', 'Windows could not unprotect this secret.', {
          cause,
        })
      }
    }
    throw new SafeStorageDecryptError('unknown-format', `Unrecognized ${format} secret format.`)
  }

  return { decrypt, format: (blob: Buffer) => electronSafeStorageFormat(sources.platform, blob) }
}
