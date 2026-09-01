import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  applyContentSecurityPolicyHeader,
  assertSecureWebPreferences,
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY,
  installCspHeaders,
  SECURE_WEB_PREFERENCES,
  shouldBlockInlineVisualizationDocumentRequest,
  shouldBlockInlineVisualizationFrameNavigation,
} from '../electron-security'

describe('shouldBlockInlineVisualizationFrameNavigation', () => {
  it('blocks self-navigation initiated by an inline visualization frame', () => {
    expect(
      shouldBlockInlineVisualizationFrameNavigation({
        isMainFrame: false,
        initiatorUrl:
          'openwaggle-visualization://frame-a/document?sessionId=s1&path=%2Frepo%2Fmap.html',
      }),
    ).toBe(true)
  })

  it('blocks navigation from a frame previously committed as a visualization', () => {
    expect(
      shouldBlockInlineVisualizationFrameNavigation({
        isMainFrame: false,
        frameIsVisualization: true,
      }),
    ).toBe(true)
  })

  it('blocks a committed visualization frame from leaving its document URL', () => {
    expect(
      shouldBlockInlineVisualizationFrameNavigation({
        isMainFrame: false,
        destinationUrl: 'https://example.com/escape',
        frameUrl: 'openwaggle-visualization://frame-a/document',
      }),
    ).toBe(true)
  })

  it('does not interfere with main-frame or unrelated extension navigation', () => {
    expect(
      shouldBlockInlineVisualizationFrameNavigation({
        isMainFrame: true,
        initiatorUrl: 'openwaggle-visualization://frame-a/document',
      }),
    ).toBe(false)
    expect(
      shouldBlockInlineVisualizationFrameNavigation({
        isMainFrame: false,
        initiatorUrl: 'openwaggle-extension-frame://frame/index.html',
      }),
    ).toBe(false)
  })

  it('allows initial host navigation into a visualization frame', () => {
    expect(
      shouldBlockInlineVisualizationFrameNavigation({
        isMainFrame: false,
        destinationUrl: 'openwaggle-visualization://frame-a/document',
        frameUrl: 'openwaggle-visualization://frame-a/document',
        initiatorUrl: 'openwaggle://app/index.html',
      }),
    ).toBe(false)
  })
})

describe('shouldBlockInlineVisualizationDocumentRequest', () => {
  it('blocks a visualization subframe from replacing itself with another document', () => {
    expect(
      shouldBlockInlineVisualizationDocumentRequest({
        resourceType: 'subFrame',
        requestUrl: 'https://example.com/escape',
        frameUrl: 'openwaggle-visualization://frame-a/document',
      }),
    ).toBe(true)
  })

  it('allows the initial visualization request and non-document resources', () => {
    expect(
      shouldBlockInlineVisualizationDocumentRequest({
        resourceType: 'subFrame',
        requestUrl: 'openwaggle-visualization://frame-a/document',
        frameUrl: '',
      }),
    ).toBe(false)
    expect(
      shouldBlockInlineVisualizationDocumentRequest({
        resourceType: 'script',
        requestUrl: 'openwaggle-visualization://frame-a/lucide.js',
        frameUrl: 'openwaggle-visualization://frame-a/document',
      }),
    ).toBe(false)
  })
})

function createSecurePreferences() {
  return {
    ...SECURE_WEB_PREFERENCES,
  }
}

function readRendererIndexHtml() {
  return readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8')
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

      expect(() => assertSecureWebPreferences(insecurePreferences)).toThrow(
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
      "script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk=' openwaggle-extension:",
    )
    expect(CONTENT_SECURITY_POLICY).toContain(
      "script-src-elem 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk=' openwaggle-extension:",
    )
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline'")
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data:")
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'self' blob: openwaggle-extension-frame:")
    expect(CONTENT_SECURITY_POLICY).toContain(
      "connect-src 'self' ws://localhost:* http://localhost:* https://localhost:* wss://localhost:* https://api.github.com",
    )
  })

  it('does not allow generic inline scripts in the app-level CSP', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src-elem 'self' 'unsafe-inline'")
  })

  it('keeps app-level CSP centralized in the Electron response header', () => {
    expect(readRendererIndexHtml()).not.toContain('Content-Security-Policy')
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

  it('applies app-level CSP to normal renderer responses', () => {
    const onHeadersReceived = vi.fn()
    const callback = vi.fn()
    const session = {
      webRequest: {
        onHeadersReceived,
      },
    }

    installCspHeaders(session)
    const handler = onHeadersReceived.mock.calls[0]?.[0]
    if (typeof handler !== 'function') {
      throw new Error('Expected CSP headers handler.')
    }

    handler(
      {
        url: 'http://localhost:5173/index.html',
        responseHeaders: { 'X-Test': ['ok'] },
      },
      callback,
    )

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'X-Test': ['ok'],
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    })
  })

  it('preserves extension frame protocol CSP responses', () => {
    const onHeadersReceived = vi.fn()
    const callback = vi.fn()
    const frameHeaders = {
      'Content-Security-Policy': ['default-src none; script-src openwaggle-extension-frame:'],
    }
    const session = {
      webRequest: {
        onHeadersReceived,
      },
    }

    installCspHeaders(session)
    const handler = onHeadersReceived.mock.calls[0]?.[0]
    if (typeof handler !== 'function') {
      throw new Error('Expected CSP headers handler.')
    }

    handler(
      {
        url: 'openwaggle-extension-frame://frame/frames/test/index.html',
        responseHeaders: frameHeaders,
      },
      callback,
    )

    expect(callback).toHaveBeenCalledWith({ responseHeaders: frameHeaders })
  })

  it('preserves the stricter inline visualization protocol CSP response', () => {
    const onHeadersReceived = vi.fn()
    const callback = vi.fn()
    const visualizationHeaders = {
      'Content-Security-Policy': ["default-src 'none'; connect-src blob: data:"],
    }
    const session = { webRequest: { onHeadersReceived } }

    installCspHeaders(session)
    const handler = onHeadersReceived.mock.calls[0]?.[0]
    if (typeof handler !== 'function') throw new Error('Expected CSP headers handler.')
    handler(
      {
        url: 'openwaggle-visualization://sandbox/document?sessionId=session-1',
        responseHeaders: visualizationHeaders,
      },
      callback,
    )

    expect(callback).toHaveBeenCalledWith({ responseHeaders: visualizationHeaders })
  })
})
