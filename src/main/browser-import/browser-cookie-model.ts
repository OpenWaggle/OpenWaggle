import { isIP } from 'node:net'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'

const IP_VERSION_6 = 6

export type ImportedCookieSameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict'

export interface ImportedBrowserCookie {
  readonly url: string
  readonly name: string
  readonly value: string
  readonly domain?: string
  readonly path: string
  readonly secure: boolean
  readonly httpOnly: boolean
  readonly expirationDate?: number
  readonly sameSite: ImportedCookieSameSite
}

export interface BrowserCookieReadResult {
  readonly cookies: readonly ImportedBrowserCookie[]
  readonly skipped: number
  readonly skippedDomains: readonly string[]
}

export function bareCookieHost(host: string) {
  return host.startsWith('.') ? host.slice(1) : host
}

function urlAuthority(host: string) {
  const bareHost = bareCookieHost(host)
  return isIP(bareHost) === IP_VERSION_6 ? `[${bareHost}]` : bareHost
}

export function cookieScope(host: string, cookiePath: string, secure: boolean) {
  if (
    host.length === 0 ||
    host.length > BROWSER_IMPORT_LIMITS.STRING_LENGTH ||
    cookiePath.length === 0 ||
    cookiePath.length > BROWSER_IMPORT_LIMITS.STRING_LENGTH ||
    !cookiePath.startsWith('/') ||
    containsCookieControl(host) ||
    containsCookieControl(cookiePath)
  ) {
    return null
  }
  try {
    const url = new URL(`${secure ? 'https' : 'http'}://${urlAuthority(host)}${cookiePath}`)
    if (url.hostname.length === 0) return null
    return {
      url: url.href,
      ...(host.startsWith('.') ? { domain: host } : {}),
    }
  } catch {
    return null
  }
}

export function boundedSkippedDomains(domains: Iterable<string>) {
  return [...new Set(domains)]
    .filter((domain) => domain.length > 0)
    .slice(0, BROWSER_IMPORT_LIMITS.SKIPPED_DOMAINS)
}

export function validCookieText(value: string) {
  return value.length <= BROWSER_IMPORT_LIMITS.STRING_LENGTH && !containsCookieControl(value)
}

function containsCookieControl(value: string) {
  return value.includes('\0') || value.includes('\r') || value.includes('\n')
}
