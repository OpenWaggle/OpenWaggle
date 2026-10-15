import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ protocol: { handle: vi.fn() } }))

import {
  mcpAppFrameResponse,
  registerMcpAppFrame,
  unregisterMcpAppFrame,
  unregisterMcpAppFramesForOwner,
} from '../mcp-app-frame-protocol'

const FRAME_ID = '12345678-1234-4123-8123-123456789abc'
const DOCUMENT_URL = `openwaggle-mcp-app://frame-${FRAME_ID}/document`
const CDN = 'https://atlassian-mcp-micros.prod-east.frontend.public.atl-paas.net'
const JIRA_APP = `<div id="jira-widget-root"></div><script type="module" src="${CDN}/assets/jira/widget.js"></script>`
const CSP = {
  resourceDomains: [CDN],
  connectDomains: ['https://as.atlassian.com'],
  frameDomains: [],
  baseUriDomains: [],
}

afterEach(() => {
  unregisterMcpAppFramesForOwner(1)
  unregisterMcpAppFramesForOwner(2)
})

describe('the MCP App frame protocol', () => {
  it('serves an App document with a policy for the origins its server declares', async () => {
    const { frameUrl } = registerMcpAppFrame({ frameId: FRAME_ID, html: JIRA_APP, csp: CSP }, 1)

    const response = mcpAppFrameResponse(frameUrl)

    expect(frameUrl).toBe(DOCUMENT_URL)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(JIRA_APP)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const policy = response.headers.get('content-security-policy') ?? ''
    expect(policy).toContain(`script-src 'unsafe-inline' ${CDN}`)
    expect(policy).toContain('connect-src https://as.atlassian.com')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
  })

  it('builds the policy itself, so a declaration that is not an origin never reaches it', () => {
    registerMcpAppFrame(
      {
        frameId: FRAME_ID,
        html: '<main></main>',
        csp: { ...CSP, resourceDomains: ["* 'unsafe-eval'"], connectDomains: ['*'] },
      },
      1,
    )

    const policy = mcpAppFrameResponse(DOCUMENT_URL).headers.get('content-security-policy') ?? ''

    expect(policy).not.toContain('unsafe-eval')
    expect(policy).toContain("connect-src 'none'")
  })

  it('serves nothing else under the scheme', () => {
    registerMcpAppFrame({ frameId: FRAME_ID, html: JIRA_APP, csp: CSP }, 1)

    expect(mcpAppFrameResponse(`openwaggle-mcp-app://frame-${FRAME_ID}/other`).status).toBe(404)
    expect(mcpAppFrameResponse(`${DOCUMENT_URL}?x=1`).status).toBe(404)
    expect(
      mcpAppFrameResponse(
        'openwaggle-mcp-app://frame-87654321-1234-4123-8123-123456789abc/document',
      ).status,
    ).toBe(404)
    expect(mcpAppFrameResponse('not a url').status).toBe(404)
  })

  it('stops serving a document once its frame is unregistered, only by the renderer that owns it', () => {
    const { registrationId } = registerMcpAppFrame(
      { frameId: FRAME_ID, html: JIRA_APP, csp: CSP },
      1,
    )

    expect(unregisterMcpAppFrame({ frameId: FRAME_ID, registrationId }, 2)).toEqual([])
    expect(mcpAppFrameResponse(DOCUMENT_URL).status).toBe(200)
    // The frame's origin is returned so its storage can be cleared.
    expect(unregisterMcpAppFrame({ frameId: FRAME_ID, registrationId }, 1)).toEqual([
      `openwaggle-mcp-app://frame-${FRAME_ID}`,
    ])
    expect(mcpAppFrameResponse(DOCUMENT_URL).status).toBe(404)
  })

  it('drops the documents of a renderer that went away', () => {
    registerMcpAppFrame({ frameId: FRAME_ID, html: JIRA_APP, csp: CSP }, 1)

    expect(unregisterMcpAppFramesForOwner(1)).toEqual([`openwaggle-mcp-app://frame-${FRAME_ID}`])

    expect(mcpAppFrameResponse(DOCUMENT_URL).status).toBe(404)
  })

  it('refuses invalid frame ids, reused ids, and oversized documents', () => {
    expect(() => registerMcpAppFrame({ frameId: '../x', html: '', csp: CSP }, 1)).toThrow(
      'Invalid MCP App frame id',
    )
    registerMcpAppFrame({ frameId: FRAME_ID, html: '', csp: CSP }, 1)
    expect(() => registerMcpAppFrame({ frameId: FRAME_ID, html: '', csp: CSP }, 1)).toThrow(
      'already registered',
    )
    expect(() =>
      registerMcpAppFrame(
        {
          frameId: '87654321-1234-4123-8123-123456789abc',
          html: 'x'.repeat(4 * 1024 * 1024 + 1),
          csp: CSP,
        },
        1,
      ),
    ).toThrow('too large')
  })
})
