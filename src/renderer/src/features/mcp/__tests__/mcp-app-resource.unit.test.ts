// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { parseMcpAppResource } from '../mcp-app-resource'

describe('an MCP App resource', () => {
  it('declares the network origins its App may use, and the device permissions it asks for', () => {
    const parsed = parseMcpAppResource({
      attribution: { serverInstanceId: 'server-1', serverLabel: 'weather' },
      contents: [
        {
          uri: 'ui://weather/app',
          mimeType: 'text/html;profile=mcp-app',
          text: '<main>Weather</main>',
          _meta: {
            ui: {
              csp: {
                connectDomains: ['https://api.example.com', 'wss://live.example.com'],
                resourceDomains: ['https://assets.example.com/', 'https://*.cdn.example.com'],
                frameDomains: ['https://player.example.com'],
              },
              permissions: { camera: {}, clipboardWrite: {} },
            },
          },
        },
      ],
    })

    expect(parsed.html).toBe('<main>Weather</main>')
    expect(parsed.csp).toEqual({
      connectDomains: ['https://api.example.com', 'wss://live.example.com'],
      resourceDomains: ['https://assets.example.com', 'https://*.cdn.example.com'],
      frameDomains: ['https://player.example.com'],
      baseUriDomains: [],
    })
    expect(parsed.requestedPermissions).toEqual(['camera', 'clipboardWrite'])
  })

  it('supports legacy flat MCP Apps resource metadata', () => {
    const parsed = parseMcpAppResource({
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
    })

    expect(parsed.csp.resourceDomains).toEqual(['https://legacy.example.com'])
    expect(parsed.requestedPermissions).toEqual(['microphone'])
  })

  it('refuses a resource without an HTML document', () => {
    expect(() =>
      parseMcpAppResource({
        attribution: { serverInstanceId: 'server-1', serverLabel: 'empty' },
        contents: [{ uri: 'ui://empty/app', blob: 'AAAA' }],
      }),
    ).toThrow('MCP App resource must contain an HTML text document.')
  })
})
