import { describe, expect, it } from 'vitest'
import { mcpAppContentSecurityPolicy, mcpAppCspSources, mcpAppFrameUrl } from '../mcp-app-csp'

const NONE = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }

describe("an MCP App frame's Content-Security-Policy", () => {
  it("loads code from the origins the server declares, as Atlassian's Jira App needs", () => {
    const cdn = 'https://atlassian-mcp-micros.prod-east.frontend.public.atl-paas.net'
    const policy = mcpAppContentSecurityPolicy({
      ...NONE,
      resourceDomains: [cdn, 'https://*.prod.public.atl-paas.net'],
      connectDomains: ['https://as.atlassian.com'],
    })

    expect(policy).toContain(`script-src 'unsafe-inline' ${cdn} https://*.prod.public.atl-paas.net`)
    expect(policy).toContain(`style-src 'unsafe-inline' ${cdn}`)
    expect(policy).toContain('connect-src https://as.atlassian.com')
    expect(policy).toContain("frame-src 'none'")
    expect(policy).toContain("base-uri 'none'")
  })

  it('reaches nothing from the network when the App declares nothing', () => {
    const policy = mcpAppContentSecurityPolicy(NONE)

    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'unsafe-inline';")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).not.toContain('unsafe-eval')
  })

  it('maps declared frame and base origins to their directives', () => {
    const policy = mcpAppContentSecurityPolicy({
      ...NONE,
      frameDomains: ['https://player.example.com'],
      baseUriDomains: ['https://cdn.example.com'],
    })

    expect(policy).toContain('frame-src https://player.example.com')
    expect(policy).toContain('base-uri https://cdn.example.com')
  })

  it('drops declarations that are not origins, so a server cannot rewrite the policy', () => {
    expect(
      mcpAppCspSources([
        '*',
        "'unsafe-eval'",
        'https://ok.example.com; script-src *',
        'https://api.example.com connect-src *',
        'javascript:alert(1)',
        'data:',
        42,
        ' https://ok.example.com/ ',
        'https://ok.example.com',
        'http://localhost:5173',
        'https://cdn.example.com/p\u0000x',
        'https://cdn.example.com/p#fragment',
        'https://cdn.example.com/pé',
        "https://cdn.example.com/a'b",
        'https://cdn.example.com/assets/app.js?v=1',
      ]),
    ).toEqual([
      'https://ok.example.com',
      'http://localhost:5173',
      'https://cdn.example.com/assets/app.js?v=1',
    ])
    expect(
      mcpAppContentSecurityPolicy({
        ...NONE,
        connectDomains: ["https://a.example.com 'unsafe-eval'"],
      }),
    ).toContain("connect-src 'none'")
  })

  it('caps how many origins one directive may list', () => {
    const many = Array.from(
      { length: 100 },
      (_, index) => `https://host${String(index)}.example.com`,
    )

    expect(mcpAppCspSources(many)).toHaveLength(64)
  })
})

describe("an MCP App frame's URL", () => {
  it('is a document under its own frame host', () => {
    expect(mcpAppFrameUrl('5c1b5f9e-8a5c-4f0a-9d8b-1f3d6c7e9a10')).toBe(
      'openwaggle-mcp-app://frame-5c1b5f9e-8a5c-4f0a-9d8b-1f3d6c7e9a10/document',
    )
  })
})
