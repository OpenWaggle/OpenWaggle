import { readFile, stat } from 'node:fs/promises'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'
import {
  type BrowserCookieReadResult,
  boundedSkippedDomains,
  cookieScope,
  type ImportedBrowserCookie,
  validCookieText,
} from './browser-cookie-model'
import {
  BrowserImportError,
  browserImportError,
  browserImportFilePermissionReason,
} from './browser-import-errors'

const FILE_HEADER_BYTES = 8
const UINT32_BYTES = 4
const DOUBLE_BYTES = 8
const PAGE_COUNT_LIMIT = 4_096
const PAGE_HEADER_BYTES = 8
const COOKIE_MIN_BYTES = 56
const COOKIE_FLAGS_OFFSET = 8
const COOKIE_DOMAIN_OFFSET = 16
const COOKIE_NAME_OFFSET = 20
const COOKIE_PATH_OFFSET = 24
const COOKIE_VALUE_OFFSET = 28
const COOKIE_EXPIRY_OFFSET = 40
const SAFARI_TO_UNIX_EPOCH_SECONDS = 978_307_200
const SECURE_FLAG = 0x1
const HTTP_ONLY_FLAG = 0x4
const PAGE_SIGNATURE = 0x100

function boundedUInt32(buffer: Buffer, offset: number, littleEndian: boolean) {
  if (offset < 0 || offset + UINT32_BYTES > buffer.length) return undefined
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
}

function boundedDouble(buffer: Buffer, offset: number) {
  if (offset < 0 || offset + DOUBLE_BYTES > buffer.length) return undefined
  const value = buffer.readDoubleLE(offset)
  return Number.isFinite(value) ? value : undefined
}

function cookieString(cookie: Buffer, offset: number) {
  if (offset < COOKIE_MIN_BYTES || offset >= cookie.length) return undefined
  const end = cookie.indexOf(0, offset)
  if (end < 0 || end - offset > BROWSER_IMPORT_LIMITS.STRING_LENGTH) return undefined
  return cookie.toString('utf8', offset, end)
}

interface SafariCookieFields {
  readonly flags: number
  readonly domain: string
  readonly name: string
  readonly cookiePath: string
  readonly value: string
  readonly expiry: number | undefined
}

function readSafariCookieFields(cookie: Buffer): SafariCookieFields | null {
  const flags = boundedUInt32(cookie, COOKIE_FLAGS_OFFSET, true)
  const domainOffset = boundedUInt32(cookie, COOKIE_DOMAIN_OFFSET, true)
  const nameOffset = boundedUInt32(cookie, COOKIE_NAME_OFFSET, true)
  const pathOffset = boundedUInt32(cookie, COOKIE_PATH_OFFSET, true)
  const valueOffset = boundedUInt32(cookie, COOKIE_VALUE_OFFSET, true)
  if (
    flags === undefined ||
    domainOffset === undefined ||
    nameOffset === undefined ||
    pathOffset === undefined ||
    valueOffset === undefined
  ) {
    return null
  }
  const domain = cookieString(cookie, domainOffset)
  const name = cookieString(cookie, nameOffset)
  const cookiePath = cookieString(cookie, pathOffset)
  const value = cookieString(cookie, valueOffset)
  if (
    domain === undefined ||
    name === undefined ||
    cookiePath === undefined ||
    value === undefined ||
    !validCookieText(name) ||
    !validCookieText(value)
  ) {
    return null
  }
  return {
    flags,
    domain,
    name,
    cookiePath,
    value,
    expiry: boundedDouble(cookie, COOKIE_EXPIRY_OFFSET),
  }
}

function parseCookie(page: Buffer, offset: number): ImportedBrowserCookie | null {
  const size = boundedUInt32(page, offset, true)
  if (size === undefined || size < COOKIE_MIN_BYTES || offset + size > page.length) return null
  const cookie = page.subarray(offset, offset + size)
  const fields = readSafariCookieFields(cookie)
  if (fields === null) return null
  const { flags, domain, name, cookiePath, value, expiry } = fields
  const secure = (flags & SECURE_FLAG) !== 0
  const scope = cookieScope(domain, cookiePath, secure)
  if (scope === null) return null
  const expirationDate =
    expiry === undefined || expiry <= 0 ? undefined : expiry + SAFARI_TO_UNIX_EPOCH_SECONDS
  return {
    ...scope,
    name,
    value,
    path: cookiePath,
    secure,
    httpOnly: (flags & HTTP_ONLY_FLAG) !== 0,
    ...(expirationDate === undefined ? {} : { expirationDate }),
    sameSite: 'unspecified',
  }
}

function parsePage(page: Buffer) {
  if (boundedUInt32(page, 0, true) !== PAGE_SIGNATURE) {
    throw new BrowserImportError('read-failed', 'The Safari cookie page has an invalid header.')
  }
  const cookieCount = boundedUInt32(page, UINT32_BYTES, true)
  if (cookieCount === undefined || cookieCount > BROWSER_IMPORT_LIMITS.COOKIES) {
    throw new BrowserImportError('read-failed', 'The Safari cookie page is malformed.')
  }
  const cookies: ImportedBrowserCookie[] = []
  let skipped = 0
  for (let index = 0; index < cookieCount; index += 1) {
    const offset = boundedUInt32(page, PAGE_HEADER_BYTES + index * UINT32_BYTES, true)
    const cookie = offset === undefined ? null : parseCookie(page, offset)
    if (cookie) cookies.push(cookie)
    else skipped += 1
  }
  return { cookies, skipped }
}

export function parseSafariBinaryCookies(buffer: Buffer): BrowserCookieReadResult {
  if (
    buffer.length < FILE_HEADER_BYTES ||
    buffer.subarray(0, UINT32_BYTES).toString('ascii') !== 'cook'
  ) {
    throw new BrowserImportError('read-failed', 'The Safari cookie store has an invalid header.')
  }
  const pageCount = boundedUInt32(buffer, UINT32_BYTES, false)
  if (pageCount === undefined || pageCount > PAGE_COUNT_LIMIT) {
    throw new BrowserImportError('resource-limit', 'The Safari cookie store has too many pages.')
  }
  const pageTableEnd = FILE_HEADER_BYTES + pageCount * UINT32_BYTES
  if (pageTableEnd > buffer.length) {
    throw new BrowserImportError('read-failed', 'The Safari cookie page table is truncated.')
  }
  let pageOffset = pageTableEnd
  const cookies: ImportedBrowserCookie[] = []
  let skipped = 0
  for (let index = 0; index < pageCount; index += 1) {
    const pageSize = boundedUInt32(buffer, FILE_HEADER_BYTES + index * UINT32_BYTES, false)
    if (
      pageSize === undefined ||
      pageSize < PAGE_HEADER_BYTES ||
      pageOffset + pageSize > buffer.length
    ) {
      throw new BrowserImportError('read-failed', 'The Safari cookie page is truncated.')
    }
    const pageResult = parsePage(buffer.subarray(pageOffset, pageOffset + pageSize))
    cookies.push(...pageResult.cookies)
    skipped += pageResult.skipped
    pageOffset += pageSize
    if (cookies.length + skipped > BROWSER_IMPORT_LIMITS.COOKIES) {
      throw new BrowserImportError(
        'resource-limit',
        'The Safari profile contains too many cookies.',
      )
    }
  }
  return { cookies, skipped, skippedDomains: boundedSkippedDomains([]) }
}

export async function readSafariCookies(databasePath: string) {
  try {
    const databaseStat = await stat(databasePath)
    if (!databaseStat.isFile() || databaseStat.size > BROWSER_IMPORT_LIMITS.DATABASE_BYTES) {
      throw new BrowserImportError(
        'resource-limit',
        'The Safari cookie store is too large to import.',
      )
    }
    return parseSafariBinaryCookies(await readFile(databasePath))
  } catch (cause) {
    const permissionReason = browserImportFilePermissionReason(
      'safari',
      'darwin',
      typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined,
    )
    if (permissionReason) {
      throw new BrowserImportError(
        permissionReason,
        permissionReason === 'needs-full-disk-access'
          ? 'Safari cookie import needs Full Disk Access in macOS System Settings.'
          : 'Safari cookie import could not read its cookie file permissions.',
        cause,
      )
    }
    throw browserImportError(cause, 'read-failed', 'The Safari cookie store could not be read.')
  }
}
