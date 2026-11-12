import { createDecipheriv, createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'
import {
  bytesColumn,
  numberColumn,
  stringColumn,
  withCookieDatabaseSnapshot,
} from './browser-cookie-database'
import {
  type BrowserCookieReadResult,
  bareCookieHost,
  boundedSkippedDomains,
  cookieScope,
  type ImportedBrowserCookie,
  validCookieText,
} from './browser-cookie-model'
import { BrowserImportError } from './browser-import-errors'
import {
  type ChromiumKeyDependencies,
  type ChromiumKeyMaterial,
  resolveChromiumKeys,
} from './chromium-cookie-keys'

const AES_CBC_IV = Buffer.alloc(16, 0x20)
const AES_GCM_NONCE_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const CHROMIUM_ENCRYPTION_PREFIX_BYTES = 3
const CHROMIUM_DOMAIN_BINDING_SCHEMA = 24
const DEFAULT_CHROMIUM_SCHEMA_VERSION = 23
const CHROMIUM_PARTITIONED_COOKIE_SCHEMA = 15
const SAMESITE_NONE = 0
const SAMESITE_LAX = 1
const SAMESITE_STRICT = 2
const WEBKIT_EPOCH_OFFSET_SECONDS = 11_644_473_600

function stripDomainBinding(plaintext: Buffer, domain: string, schemaVersion: number) {
  if (schemaVersion < CHROMIUM_DOMAIN_BINDING_SCHEMA) return plaintext
  const domainHash = createHash('sha256').update(domain).digest()
  return plaintext.length >= domainHash.length &&
    plaintext.subarray(0, domainHash.length).equals(domainHash)
    ? plaintext.subarray(domainHash.length)
    : null
}

function decryptCbcVersion(
  prefix: string,
  payload: Buffer,
  keys: ChromiumKeyMaterial,
  domain: string,
  schemaVersion: number,
) {
  const key = prefix === 'v10' ? keys.cbcV10 : prefix === 'v11' ? keys.cbcV11 : undefined
  if (!key) return null
  return (
    decryptCbc(payload, key, domain, schemaVersion) ??
    (keys.cbcEmpty ? decryptCbc(payload, keys.cbcEmpty, domain, schemaVersion) : null)
  )
}

function decryptWindowsValue(
  prefix: string,
  payload: Buffer,
  keys: ChromiumKeyMaterial,
  domain: string,
  schemaVersion: number,
) {
  if (prefix !== 'v10' || !keys.gcmV10) return null
  return decryptGcm(payload, keys.gcmV10, domain, schemaVersion)
}

function decryptCbc(payload: Buffer, key: Buffer, domain: string, schemaVersion: number) {
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, AES_CBC_IV)
    const plaintext = Buffer.concat([decipher.update(payload), decipher.final()])
    return stripDomainBinding(plaintext, domain, schemaVersion)?.toString('utf8') ?? null
  } catch {
    return null
  }
}

function decryptGcm(payload: Buffer, key: Buffer, domain: string, schemaVersion: number) {
  if (payload.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) return null
  try {
    const nonce = payload.subarray(0, AES_GCM_NONCE_BYTES)
    const ciphertext = payload.subarray(AES_GCM_NONCE_BYTES, -AES_GCM_TAG_BYTES)
    const tag = payload.subarray(-AES_GCM_TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return stripDomainBinding(plaintext, domain, schemaVersion)?.toString('utf8') ?? null
  } catch {
    return null
  }
}

export function decryptChromiumValue(
  encrypted: Uint8Array,
  keys: ChromiumKeyMaterial,
  domain: string,
  schemaVersion = DEFAULT_CHROMIUM_SCHEMA_VERSION,
  platform: NodeJS.Platform = 'linux',
) {
  const buffer = Buffer.from(encrypted)
  if (buffer.length === 0) return ''
  const prefix = buffer.subarray(0, CHROMIUM_ENCRYPTION_PREFIX_BYTES).toString('latin1')
  const payload = buffer.subarray(CHROMIUM_ENCRYPTION_PREFIX_BYTES)
  if (platform === 'win32') {
    return decryptWindowsValue(prefix, payload, keys, domain, schemaVersion)
  }
  if (prefix === 'v10' || prefix === 'v11') {
    return decryptCbcVersion(prefix, payload, keys, domain, schemaVersion)
  }
  return platform === 'darwin' || platform === 'linux'
    ? (stripDomainBinding(buffer, domain, schemaVersion)?.toString('utf8') ?? null)
    : null
}

function chromiumSameSite(value: number) {
  if (value === SAMESITE_NONE) return 'no_restriction'
  if (value === SAMESITE_LAX) return 'lax'
  if (value === SAMESITE_STRICT) return 'strict'
  return 'unspecified'
}

function chromiumExpiration(webkitSeconds: number) {
  return webkitSeconds <= 0 ? undefined : webkitSeconds - WEBKIT_EPOCH_OFFSET_SECONDS
}

function readSchemaVersion(database: DatabaseSync) {
  const row = database.prepare("SELECT value FROM meta WHERE key = 'version' LIMIT 1").get()
  const value = row?.value
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BrowserImportError('read-failed', 'The Chromium cookie schema is unsupported.')
  }
  return parsed
}

function queryCookieRows(database: DatabaseSync, schemaVersion: number) {
  const partitionColumn =
    schemaVersion >= CHROMIUM_PARTITIONED_COOKIE_SCHEMA ? 'top_frame_site_key' : "''"
  return database
    .prepare(
      `SELECT host_key, name, value, encrypted_value, path,
              expires_utc / 1000000.0 AS expires_seconds,
              is_secure, is_httponly, samesite,
              ${partitionColumn} AS top_frame_site_key
         FROM cookies
        LIMIT ?`,
    )
    .all(BROWSER_IMPORT_LIMITS.COOKIES + 1)
}

interface DecodedChromiumRow {
  readonly cookie: ImportedBrowserCookie | null
  readonly host: string
  readonly needsV11: boolean
}

interface ChromiumCookieColumns {
  readonly host: string
  readonly name: string
  readonly clearValue: string
  readonly encryptedValue: Uint8Array
  readonly cookiePath: string
  readonly expiresSeconds: number
}

interface ChromiumCookieColumnRead {
  readonly columns: ChromiumCookieColumns | null
  readonly host: string
  readonly needsV11: boolean
}

function readChromiumCookieColumns(row: Record<string, unknown>): ChromiumCookieColumnRead {
  const host = stringColumn(row, 'host_key') ?? ''
  const name = stringColumn(row, 'name')
  const clearValue = stringColumn(row, 'value')
  const encryptedValue = bytesColumn(row, 'encrypted_value')
  const cookiePath = stringColumn(row, 'path')
  const expiresSeconds = numberColumn(row, 'expires_seconds')
  const partitionKey = stringColumn(row, 'top_frame_site_key')
  const prefix = encryptedValue
    ? Buffer.from(encryptedValue).subarray(0, CHROMIUM_ENCRYPTION_PREFIX_BYTES).toString('latin1')
    : ''
  const needsV11 = partitionKey === '' && prefix === 'v11'
  if (
    name === undefined ||
    clearValue === undefined ||
    encryptedValue === undefined ||
    cookiePath === undefined ||
    expiresSeconds === undefined ||
    partitionKey !== '' ||
    !validCookieText(name)
  ) {
    return { columns: null, host, needsV11 }
  }
  return {
    columns: { host, name, clearValue, encryptedValue, cookiePath, expiresSeconds },
    host,
    needsV11,
  }
}

function decodeCookieRow(
  row: Record<string, unknown>,
  keys: ChromiumKeyMaterial,
  schemaVersion: number,
  platform: NodeJS.Platform,
): DecodedChromiumRow {
  const { columns, host, needsV11 } = readChromiumCookieColumns(row)
  if (columns === null) return { cookie: null, host, needsV11 }
  const { name, clearValue, encryptedValue, cookiePath, expiresSeconds } = columns
  const value =
    encryptedValue.length === 0
      ? clearValue
      : decryptChromiumValue(encryptedValue, keys, host, schemaVersion, platform)
  const secure = numberColumn(row, 'is_secure') === 1
  const scope = cookieScope(host, cookiePath, secure)
  if (value === null || !validCookieText(value) || scope === null) {
    return { cookie: null, host, needsV11 }
  }
  const expirationDate = chromiumExpiration(expiresSeconds)
  return {
    cookie: {
      ...scope,
      name,
      value,
      path: cookiePath,
      secure,
      httpOnly: numberColumn(row, 'is_httponly') === 1,
      ...(expirationDate === undefined ? {} : { expirationDate }),
      sameSite: chromiumSameSite(numberColumn(row, 'samesite') ?? -1),
    },
    host,
    needsV11,
  }
}

export function readChromiumCookieDatabase(
  database: DatabaseSync,
  keys: ChromiumKeyMaterial,
  platform: NodeJS.Platform,
): BrowserCookieReadResult {
  const schemaVersion = readSchemaVersion(database)
  const rows = queryCookieRows(database, schemaVersion)
  if (rows.length > BROWSER_IMPORT_LIMITS.COOKIES) {
    throw new BrowserImportError(
      'resource-limit',
      'The Chromium profile contains too many cookies.',
    )
  }
  const cookies: ImportedBrowserCookie[] = []
  const skippedDomains: string[] = []
  let skipped = 0
  let needsV11 = false
  for (const row of rows) {
    const decoded = decodeCookieRow(row, keys, schemaVersion, platform)
    needsV11 ||= decoded.needsV11
    if (decoded.cookie) cookies.push(decoded.cookie)
    else {
      skipped += 1
      skippedDomains.push(bareCookieHost(decoded.host))
    }
  }
  if (cookies.length === 0 && needsV11 && keys.cbcV11Error) throw keys.cbcV11Error
  return { cookies, skipped, skippedDomains: boundedSkippedDomains(skippedDomains) }
}

export interface ChromiumCookieSource {
  readonly cookieDatabasePath: string
  readonly platform: NodeJS.Platform
  readonly keychainService?: string
  readonly keychainAccount?: string
  readonly linuxSecretApplication?: string
  readonly windowsLocalStatePath?: string
}

export async function readChromiumCookies(
  source: ChromiumCookieSource,
  dependencies: ChromiumKeyDependencies = {},
) {
  const keys = await resolveChromiumKeys(source, dependencies)
  return withCookieDatabaseSnapshot(source.cookieDatabasePath, (database) =>
    readChromiumCookieDatabase(database, keys, source.platform),
  )
}
