import { describe, expect, it } from 'vitest'
import { getMcpToolExposure, mcpNamespace } from '../mcp-server-config'
import { validateMcpServerEntry } from '../mcp-server-entry-validation'

const plainFile = { allowSecretReferences: false }

describe('MCP server entry validation', () => {
  it("resolves Pi's exposure aliases and drops unknown fields", () => {
    expect(
      validateMcpServerEntry(
        's',
        {
          command: 'x',
          exposure: 'codemode-deferred',
          toolExposure: { a: 'codemode-deferred' },
          provenance: { source: 'codex' },
        },
        plainFile,
      ),
    ).toEqual({
      ok: true,
      server: {
        config: { command: 'x', exposure: 'codemode', toolExposure: { a: 'codemode' } },
        transport: 'stdio',
      },
    })
  })

  it('reports the first problem in the order Pi checks them', () => {
    expect(validateMcpServerEntry('s', { url: 'https://a', exposure: 'loud' }, plainFile)).toEqual({
      ok: false,
      error: 'server "s": exposure must be one of "codemode", "deferred", "direct", "hidden"',
    })
    expect(
      validateMcpServerEntry(
        's',
        { url: 'https://a', oauth: { callbackPort: 0, clientId: 3 } },
        plainFile,
      ),
    ).toEqual({ ok: false, error: 'server "s": oauth.clientId must be a string' })
    expect(
      validateMcpServerEntry(
        's',
        { url: 'https://a', oauth: { clientRegistration: 'cimd', clientName: 'x' } },
        plainFile,
      ),
    ).toEqual({
      ok: false,
      error:
        'server "s": oauth.clientRegistration "cimd" cannot be combined with oauth.clientId or oauth.clientName',
    })
    expect(validateMcpServerEntry('s', { url: 'ftp://a' }, plainFile)).toEqual({
      ok: false,
      error: 'server "s": url must be an http, https, ws, or wss URL',
    })
    expect(validateMcpServerEntry('s', { type: 'http', url: 'wss://a' }, plainFile)).toEqual({
      ok: false,
      error: 'server "s": url must be an http or https URL',
    })
    expect(validateMcpServerEntry('s', { command: 'x', timeout: 0 }, plainFile)).toEqual({
      ok: false,
      error: 'server "s": timeout must be a positive number of seconds',
    })
  })

  it('accepts a stdio command with type stdio even when a url is present', () => {
    expect(
      validateMcpServerEntry('s', { type: 'stdio', url: 'https://a', command: 'x' }, plainFile),
    ).toEqual({ ok: true, server: { config: { command: 'x' }, transport: 'stdio' } })
  })

  it('matches exact tool names before patterns, and the first pattern among patterns', () => {
    const config = {
      exposure: 'deferred',
      toolExposure: { 'get_*': 'codemode', get_issue: 'direct', '*': 'hidden' },
    } as const

    expect(getMcpToolExposure(config, 'get_issue')).toBe('direct')
    expect(getMcpToolExposure(config, 'get_repo')).toBe('codemode')
    expect(getMcpToolExposure(config, 'delete')).toBe('hidden')
    expect(getMcpToolExposure({}, 'anything')).toBe('codemode')
    expect(mcpNamespace('dev-radius')).toBe('mcp__dev_radius')
  })
})
