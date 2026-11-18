import { describe, expect, it } from 'vitest'
import { mcpConnectionFingerprint, mcpServerIdentity } from '../mcp-server-identity'

describe('MCP server identity and connection fingerprint', () => {
  it('binds grants to the name and what the server runs, not to its settings', () => {
    const base = mcpServerIdentity('fs', { command: 'npx', args: ['server-fs'] })

    expect(
      mcpServerIdentity('fs', {
        command: 'npx',
        args: ['server-fs'],
        exposure: 'direct',
        env: { A: '1' },
      }),
    ).toBe(base)
    expect(mcpServerIdentity('fs', { command: 'npx', args: ['other-fs'] })).not.toBe(base)
    expect(mcpServerIdentity('fs2', { command: 'npx', args: ['server-fs'] })).not.toBe(base)
    expect(base).toMatch(/^mcp-server:[0-9a-f]{16}$/)
  })

  it('keeps a connection across exposure changes and replaces it when the connection changes', () => {
    const fingerprint = (
      config: Parameters<typeof mcpConnectionFingerprint>[0]['config'],
      cwd = '/w',
    ) => mcpConnectionFingerprint({ config, transport: 'http', cwd })
    const base = fingerprint({ url: 'https://a', headers: { B: '2', A: '1' } })

    expect(
      fingerprint({
        headers: { A: '1', B: '2' },
        url: 'https://a',
        exposure: 'direct',
        enabled: false,
      }),
    ).toBe(base)
    expect(fingerprint({ url: 'https://a', headers: { A: 'rotated', B: '2' } })).not.toBe(base)
    expect(fingerprint({ url: 'https://a', headers: { B: '2', A: '1' } }, '/other')).not.toBe(base)
  })
})
