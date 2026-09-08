import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'
import { numberColumn, stringColumn, withCookieDatabaseSnapshot } from './browser-cookie-database'
import {
  type BrowserCookieReadResult,
  boundedSkippedDomains,
  cookieScope,
  type ImportedBrowserCookie,
  validCookieText,
} from './browser-cookie-model'
import { BrowserImportError } from './browser-import-errors'

const FIREFOX_RAW_SAMESITE_FIRST_SCHEMA = 10
const FIREFOX_RAW_SAMESITE_LAST_SCHEMA = 14
const FIREFOX_EXPIRY_MILLISECONDS_SCHEMA = 16
const MILLISECONDS_PER_SECOND = 1_000
const SAMESITE_NONE = 0
const SAMESITE_LAX = 1
const SAMESITE_STRICT = 2

function firefoxSameSite(value: number | undefined, rawValue: number | undefined) {
  if (value === undefined) return 'unspecified'
  if (value === SAMESITE_LAX && rawValue === SAMESITE_NONE) return 'unspecified'
  if (value === SAMESITE_NONE) return 'no_restriction'
  if (value === SAMESITE_LAX) return 'lax'
  if (value === SAMESITE_STRICT) return 'strict'
  return 'unspecified'
}

function firefoxExpiration(expiry: number, schemaVersion: number) {
  if (expiry <= 0) return undefined
  return schemaVersion >= FIREFOX_EXPIRY_MILLISECONDS_SCHEMA
    ? Math.floor(expiry / MILLISECONDS_PER_SECOND)
    : expiry
}

function decodeFirefoxCookie(
  row: Record<string, unknown>,
  schemaVersion: number,
): ImportedBrowserCookie | null {
  const host = stringColumn(row, 'host')
  const name = stringColumn(row, 'name')
  const value = stringColumn(row, 'value')
  const cookiePath = stringColumn(row, 'path')
  const expiry = numberColumn(row, 'expiry')
  if (
    host === undefined ||
    name === undefined ||
    value === undefined ||
    cookiePath === undefined ||
    expiry === undefined ||
    !validCookieText(name) ||
    !validCookieText(value)
  ) {
    return null
  }
  const secure = numberColumn(row, 'isSecure') === 1
  const scope = cookieScope(host, cookiePath, secure)
  if (scope === null) return null
  const expirationDate = firefoxExpiration(expiry, schemaVersion)
  return {
    ...scope,
    name,
    value,
    path: cookiePath,
    secure,
    httpOnly: numberColumn(row, 'isHttpOnly') === 1,
    ...(expirationDate === undefined ? {} : { expirationDate }),
    sameSite: firefoxSameSite(numberColumn(row, 'sameSite'), numberColumn(row, 'rawSameSite')),
  }
}

export async function readFirefoxCookies(databasePath: string): Promise<BrowserCookieReadResult> {
  return withCookieDatabaseSnapshot(databasePath, (database) => {
    const versionRow = database.prepare('PRAGMA user_version').get()
    const schemaVersion = versionRow ? (numberColumn(versionRow, 'user_version') ?? 0) : 0
    const hasRawSameSite =
      schemaVersion >= FIREFOX_RAW_SAMESITE_FIRST_SCHEMA &&
      schemaVersion <= FIREFOX_RAW_SAMESITE_LAST_SCHEMA
    const rawSameSiteColumn = hasRawSameSite ? 'rawSameSite' : 'NULL AS rawSameSite'
    const rows = database
      .prepare(
        `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite,
                ${rawSameSiteColumn}
           FROM moz_cookies
          WHERE originAttributes = ''
          LIMIT ?`,
      )
      .all(BROWSER_IMPORT_LIMITS.COOKIES + 1)
    if (rows.length > BROWSER_IMPORT_LIMITS.COOKIES) {
      throw new BrowserImportError(
        'resource-limit',
        'The Firefox profile contains too many cookies.',
      )
    }

    const cookies: ImportedBrowserCookie[] = []
    const skippedDomains: string[] = []
    let skipped = 0
    for (const row of rows) {
      const cookie = decodeFirefoxCookie(row, schemaVersion)
      if (cookie) cookies.push(cookie)
      else {
        skipped += 1
        skippedDomains.push(stringColumn(row, 'host') ?? '')
      }
    }
    return { cookies, skipped, skippedDomains: boundedSkippedDomains(skippedDomains) }
  })
}
