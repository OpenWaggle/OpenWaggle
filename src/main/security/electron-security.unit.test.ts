import { describe, expect, it, vi } from 'vitest'
import {
  applyContentSecurityPolicyHeader,
  assertSecureWebPreferences,
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY,
  installCspHeaders,
  SECURE_WEB_PREFERENCES,
} from './electron-security'

function createSecurePreferences() {
  return {
    ...SECURE_WEB_PREFERENCES,
  }
}

describe('assertSecureWebPreferences', () => {
  it('accepts secure preferences', () => {
    expect(() => assertSecureWebPreferences(createSecurePreferences())).not.toThrow()
  })

  it('throws when a required preference is insecure', () => {
    const cases = [
      {
        preference: 'nodeIntegration',
        expected: false,
        actual: true,
      },
      {
        preference: 'contextIsolation',
        expected: true,
        actual: false,
      },
      {
        preference: 'sandbox',
        expected: true,
        actual: false,
      },
      {
        preference: 'webSecurity',
        expected: true,
        actual: false,
      },
      {
        preference: 'allowRunningInsecureContent',
        expected: false,
        actual: true,
      },
    ] as const

    for (const testCase of cases) {
      const insecurePreferences = {
        ...createSecurePreferences(),
        [testCase.preference]: testCase.actual,
      }

      expect(() => assertSecureWebPreferences(insecurePreferences)).toThrowError(
        `Insecure BrowserWindow webPreferences: "${testCase.preference}" must be ${String(testCase.expected)}, received ${String(testCase.actual)}.`,
      )
    }
  })
})

describe('buildContentSecurityPolicy', () => {
  it('returns the expected directives', () => {
    expect(buildContentSecurityPolicy()).toBe(CONTENT_SECURITY_POLICY)
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain(
      "script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='",
    )
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline'")
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data:")
    expect(CONTENT_SECURITY_POLICY).toContain(
      "connect-src 'self' ws://localhost:* http://localhost:* https://localhost:* wss://localhost:*",
    )
  })
})

describe('applyContentSecurityPolicyHeader', () => {
  it('adds the CSP header while preserving existing response headers', () => {
    const updatedHeaders = applyContentSecurityPolicyHeader({ 'X-Test': ['ok'] })

    expect(updatedHeaders).toMatchObject({
      'X-Test': ['ok'],
      'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
    })
  })
})

describe('installCspHeaders', () => {
  it('registers a single headers handler per session', () => {
    const onHeadersReceived = vi.fn()

    const session = {
      webRequest: {
        onHeadersReceived,
      },
    }

    installCspHeaders(session)
    installCspHeaders(session)

    expect(onHeadersReceived).toHaveBeenCalledOnce()
  })
})
