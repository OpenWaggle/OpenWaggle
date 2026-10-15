import { describe, expect, it, vi } from 'vitest'
import {
  CONTENT_SECURITY_POLICY,
  installCspHeaders,
  shouldBlockMcpAppFrameNavigation,
} from '../electron-security'

describe('shouldBlockMcpAppFrameNavigation', () => {
  const APP = 'openwaggle-mcp-app://frame-12345678-1234-4123-8123-123456789abc/document'

  it('keeps an MCP App frame on the document the Host served it', () => {
    expect(
      shouldBlockMcpAppFrameNavigation({
        isMainFrame: false,
        isSameDocument: false,
        destinationUrl: 'https://attacker.example.com',
        frameUrl: APP,
      }),
    ).toBe(true)
    // A tracked App frame whose URL is not reported yet is still kept on it.
    expect(
      shouldBlockMcpAppFrameNavigation({
        isMainFrame: false,
        isSameDocument: false,
        destinationUrl: 'https://attacker.example.com',
        frameIsMcpApp: true,
      }),
    ).toBe(true)
  })

  it("allows the frame's first load, its reload, and the App's own same-document navigation", () => {
    expect(
      shouldBlockMcpAppFrameNavigation({
        isMainFrame: false,
        isSameDocument: false,
        destinationUrl: APP,
        frameUrl: 'about:blank',
      }),
    ).toBe(false)
    expect(
      shouldBlockMcpAppFrameNavigation({
        isMainFrame: false,
        isSameDocument: false,
        destinationUrl: APP,
        frameUrl: APP,
      }),
    ).toBe(false)
    expect(
      shouldBlockMcpAppFrameNavigation({
        isMainFrame: false,
        isSameDocument: true,
        destinationUrl: `${APP}#issues`,
        frameUrl: APP,
      }),
    ).toBe(false)
  })

  it('leaves frames an App opens itself, and the main frame, to their own rules', () => {
    expect(
      shouldBlockMcpAppFrameNavigation({
        isMainFrame: false,
        isSameDocument: false,
        destinationUrl: 'https://player.example.com/embed',
        frameUrl: 'about:blank',
      }),
    ).toBe(false)
    expect(
      shouldBlockMcpAppFrameNavigation({
        isMainFrame: true,
        isSameDocument: false,
        destinationUrl: 'https://example.com',
        frameUrl: APP,
      }),
    ).toBe(false)
  })
})

describe('the CSP of MCP App frames (ADR 0053)', () => {
  it('lets the page embed App documents from their own frame origins', () => {
    expect(CONTENT_SECURITY_POLICY).toMatch(/frame-src [^;]*openwaggle-mcp-app:/)
  })

  it("preserves an MCP App frame's own CSP response, which allows what its server declares", () => {
    const onHeadersReceived = vi.fn()
    const callback = vi.fn()
    const appHeaders = {
      'Content-Security-Policy': [
        "default-src 'none'; script-src 'unsafe-inline' https://cdn.example.com",
      ],
    }
    const session = { webRequest: { onHeadersReceived } }

    installCspHeaders(session)
    const handler = onHeadersReceived.mock.calls[0]?.[0]
    if (typeof handler !== 'function') throw new Error('Expected CSP headers handler.')
    handler(
      {
        url: 'openwaggle-mcp-app://frame-12345678-1234-4123-8123-123456789abc/document',
        responseHeaders: appHeaders,
      },
      callback,
    )

    expect(callback).toHaveBeenCalledWith({ responseHeaders: appHeaders })
  })
})
