import { pbkdf2Sync } from 'node:crypto'
import { open } from 'node:fs/promises'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'
import {
  type CredentialHelperResult,
  runCredentialHelper,
  windowsPowerShellExecutable,
} from './browser-credential-helper'
import { BrowserImportError, browserImportError } from './browser-import-errors'

const KEY_SALT = 'saltysalt'
const CBC_KEY_BYTES = 16
const WINDOWS_KEY_BYTES = 32
const MAC_KEY_ITERATIONS = 1_003
const LINUX_KEY_ITERATIONS = 1
const BASE64_GROUP_LENGTH = 4
const LINUX_FALLBACK_PASSPHRASE = 'peanuts'
const DPAPI_PREFIX = Buffer.from('DPAPI')
const WINDOWS_DPAPI_SCRIPT =
  'Add-Type -AssemblyName System.Security;' +
  '$value=[Console]::In.ReadToEnd();' +
  '$encrypted=[Convert]::FromBase64String($value);' +
  '$plain=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
  '[Console]::Out.Write([Convert]::ToBase64String($plain))'

export interface ChromiumKeyMaterial {
  readonly cbcV10?: Buffer
  readonly cbcV11?: Buffer
  readonly cbcEmpty?: Buffer
  readonly gcmV10?: Buffer
  readonly cbcV11Error?: BrowserImportError
}

export interface ChromiumKeyRequest {
  readonly platform: NodeJS.Platform
  readonly keychainService?: string
  readonly keychainAccount?: string
  readonly linuxSecretApplication?: string
  readonly windowsLocalStatePath?: string
}

export interface ChromiumKeyDependencies {
  readonly readMacSecret?: (service: string, account: string) => Promise<string | null>
  readonly runHelper?: (
    command: string,
    args: readonly string[],
    input?: string,
  ) => Promise<CredentialHelperResult>
}

export function deriveChromiumCbcKey(passphrase: string, iterations: number) {
  return pbkdf2Sync(passphrase, KEY_SALT, iterations, CBC_KEY_BYTES, 'sha1')
}

async function defaultReadMacSecret(service: string, account: string) {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  return (await new AsyncEntry(service, account).getPassword()) ?? null
}

async function readMacSecret(
  service: string,
  account: string,
  dependency: ChromiumKeyDependencies['readMacSecret'],
) {
  try {
    const secret = await (dependency ?? defaultReadMacSecret)(service, account)
    if (secret === null || secret.length === 0) {
      throw new BrowserImportError(
        'keychain-item-missing',
        'The browser encryption key was not found in the login keychain.',
      )
    }
    return secret
  } catch (cause) {
    if (cause instanceof BrowserImportError) throw cause
    const message = cause instanceof Error ? cause.message : String(cause)
    const reason = /no (matching )?entry|not found/iu.test(message)
      ? 'keychain-item-missing'
      : 'needs-keychain-approval'
    throw new BrowserImportError(
      reason,
      'The login keychain did not provide the browser key.',
      cause,
    )
  }
}

async function readLinuxSecret(
  application: string,
  runner: NonNullable<ChromiumKeyDependencies['runHelper']>,
) {
  const result = await runner('/usr/bin/secret-tool', ['lookup', 'application', application])
  const secret = result.stdout.replace(/\r?\n$/u, '')
  if (result.exitCode === 0 && secret.length > 0) return secret
  const detail = result.stderr.toLowerCase()
  if (/denied|cancel|locked/u.test(detail)) {
    throw new BrowserImportError(
      'needs-keychain-approval',
      'The desktop keyring did not authorize access to the browser key.',
    )
  }
  const reason = /not found|no such/u.test(detail)
    ? 'keychain-item-missing'
    : 'keychain-unavailable'
  throw new BrowserImportError(reason, 'The browser key was unavailable from Secret Service.')
}

function decodeStrictBase64(value: string) {
  if (
    value.length === 0 ||
    value.length % BASE64_GROUP_LENGTH !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(value)
  ) {
    return undefined
  }
  const decoded = Buffer.from(value, 'base64')
  return decoded.toString('base64') === value ? decoded : undefined
}

export function decodeWindowsWrappedKey(contents: string) {
  let state: unknown
  try {
    state = JSON.parse(contents)
  } catch (cause) {
    throw new BrowserImportError('read-failed', 'The browser Local State file is invalid.', cause)
  }
  if (typeof state !== 'object' || state === null || !('os_crypt' in state)) {
    throw new BrowserImportError('read-failed', 'The browser Local State has no encryption key.')
  }
  const osCrypt = state.os_crypt
  if (typeof osCrypt !== 'object' || osCrypt === null) {
    throw new BrowserImportError('read-failed', 'The browser Local State has no encryption key.')
  }
  if ('app_bound_encrypted_key' in osCrypt) {
    throw new BrowserImportError(
      'unsupported-platform',
      'This browser uses Windows App-Bound Encryption and cannot be imported safely.',
    )
  }
  if (!('encrypted_key' in osCrypt) || typeof osCrypt.encrypted_key !== 'string') {
    throw new BrowserImportError('read-failed', 'The browser Local State has no encryption key.')
  }
  const encoded = decodeStrictBase64(osCrypt.encrypted_key)
  if (encoded === undefined || !encoded.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
    throw new BrowserImportError(
      'read-failed',
      'The browser Local State encryption key is invalid.',
    )
  }
  return encoded.subarray(DPAPI_PREFIX.length)
}

async function readBoundedText(filePath: string) {
  const file = await open(filePath, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > BROWSER_IMPORT_LIMITS.LOCAL_STATE_BYTES) {
      throw new BrowserImportError('resource-limit', 'The browser Local State file is too large.')
    }
    const buffer = Buffer.alloc(info.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    await file.close()
  }
}

async function readWindowsKey(
  localStatePath: string,
  runner: NonNullable<ChromiumKeyDependencies['runHelper']>,
) {
  const wrapped = decodeWindowsWrappedKey(await readBoundedText(localStatePath))
  const result = await runner(
    windowsPowerShellExecutable(),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      WINDOWS_DPAPI_SCRIPT,
    ],
    wrapped.toString('base64'),
  )
  const key = result.exitCode === 0 ? decodeStrictBase64(result.stdout.trim()) : undefined
  if (key?.byteLength !== WINDOWS_KEY_BYTES) {
    throw new BrowserImportError('read-failed', 'Windows could not unwrap the browser key.')
  }
  return key
}

export async function resolveChromiumKeys(
  request: ChromiumKeyRequest,
  dependencies: ChromiumKeyDependencies = {},
): Promise<ChromiumKeyMaterial> {
  if (request.platform === 'darwin') {
    if (!request.keychainService || !request.keychainAccount) {
      throw new BrowserImportError(
        'unsupported-platform',
        'This browser has no macOS keychain entry.',
      )
    }
    const secret = await readMacSecret(
      request.keychainService,
      request.keychainAccount,
      dependencies.readMacSecret,
    )
    return { cbcV10: deriveChromiumCbcKey(secret, MAC_KEY_ITERATIONS) }
  }
  if (request.platform === 'linux') {
    const base = {
      cbcV10: deriveChromiumCbcKey(LINUX_FALLBACK_PASSPHRASE, LINUX_KEY_ITERATIONS),
      cbcEmpty: deriveChromiumCbcKey('', LINUX_KEY_ITERATIONS),
    }
    if (!request.linuxSecretApplication) return base
    try {
      const secret = await readLinuxSecret(
        request.linuxSecretApplication,
        dependencies.runHelper ?? runCredentialHelper,
      )
      return { ...base, cbcV11: deriveChromiumCbcKey(secret, LINUX_KEY_ITERATIONS) }
    } catch (cause) {
      const error = browserImportError(
        cause,
        'keychain-unavailable',
        'The browser key was unavailable from Secret Service.',
      )
      if (error.reason === 'needs-keychain-approval') throw error
      return { ...base, cbcV11Error: error }
    }
  }
  if (request.platform === 'win32' && request.windowsLocalStatePath) {
    return {
      gcmV10: await readWindowsKey(
        request.windowsLocalStatePath,
        dependencies.runHelper ?? runCredentialHelper,
      ),
    }
  }
  throw new BrowserImportError(
    'unsupported-platform',
    'Cookie decryption is unavailable for this browser and platform.',
  )
}
