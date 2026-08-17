// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { parseMcpAppResource } from '../mcp-app-resource'

describe('MCP App resource sandbox policy', () => {
  it('intersects declared network origins with explicit server grants and blocks device permissions', () => {
    const parsed = parseMcpAppResource(
      {
        attribution: { serverInstanceId: 'server-1', serverLabel: 'weather' },
        contents: [
          {
            uri: 'ui://weather/app',
            mimeType: 'text/html;profile=mcp-app',
            text: '<html><head></head><body><script>window.ready = true</script></body></html>',
            _meta: {
              ui: {
                csp: {
                  connectDomains: ['https://api.example.com', 'https://blocked.example.com'],
                  resourceDomains: ['https://assets.example.com'],
                },
                permissions: { camera: {}, clipboardWrite: {} },
              },
            },
          },
        ],
      },
      ['https://api.example.com'],
    )

    expect(parsed.csp).toEqual({
      connectDomains: ['https://api.example.com'],
      resourceDomains: [],
    })
    expect(parsed.requestedPermissions).toEqual(['camera', 'clipboardWrite'])
    expect(parsed.html).toContain('Content-Security-Policy')
    expect(parsed.html).toContain('connect-src https://api.example.com')
    expect(parsed.html).not.toContain('blocked.example.com')
    expect(parsed.html).toContain("frame-src 'none'")
  })

  it('supports legacy flat MCP Apps resource metadata', () => {
    const parsed = parseMcpAppResource(
      {
        attribution: { serverInstanceId: 'server-1', serverLabel: 'legacy' },
        contents: [
          {
            uri: 'ui://legacy/app',
            text: '<main>Legacy app</main>',
            _meta: {
              'ui/csp': { resourceDomains: ['https://legacy.example.com'] },
              'ui/permissions': { microphone: {} },
            },
          },
        ],
      },
      ['https://legacy.example.com'],
    )

    expect(parsed.csp.resourceDomains).toEqual(['https://legacy.example.com'])
    expect(parsed.requestedPermissions).toEqual(['microphone'])
  })

  it('prepends CSP to the parser-identified head instead of a decoy in a comment', () => {
    const parsed = parseMcpAppResource(
      {
        attribution: { serverInstanceId: 'server-1', serverLabel: 'untrusted' },
        contents: [
          {
            uri: 'ui://untrusted/app',
            text: '<!doctype html><!-- <head> --><html><head><script>window.attack()</script></head><body></body></html>',
          },
        ],
      },
      [],
    )

    const cspIndex = parsed.html.indexOf('Content-Security-Policy')
    const scriptIndex = parsed.html.indexOf('<script>')
    const document_ = new DOMParser().parseFromString(parsed.html, 'text/html')
    expect(cspIndex).toBeGreaterThan(-1)
    expect(scriptIndex).toBeGreaterThan(cspIndex)
    expect(parsed.html).not.toContain('<!-- <head><meta')
    expect(document_.head.firstElementChild?.getAttribute('http-equiv')).toBe(
      'Content-Security-Policy',
    )
  })
})
