import { describe, expect, it } from 'vitest'
import { withMcpAppToolsDeclared, withOpenWaggleRuntimeExposure } from '../mcp-runtime-exposure'

describe('MCP exposure as OpenWaggle runs it', () => {
  it("runs a server's and its tools' direct as codemode, and keeps the other exposures", () => {
    expect(
      withOpenWaggleRuntimeExposure({
        command: 'docs-mcp',
        exposure: 'direct',
        toolExposure: { search: 'direct', 'delete*': 'hidden', list: 'deferred' },
      }),
    ).toEqual({
      command: 'docs-mcp',
      exposure: 'codemode',
      toolExposure: { search: 'codemode', 'delete*': 'hidden', list: 'deferred' },
    })
    expect(
      withOpenWaggleRuntimeExposure({ command: 'a', toolExposure: { one: 'direct' } }),
    ).toEqual({
      command: 'a',
      toolExposure: { one: 'codemode' },
    })
  })

  it('leaves a configuration without direct unchanged', () => {
    const config = { url: 'https://docs.example/mcp', exposure: 'hidden' as const }

    expect(withOpenWaggleRuntimeExposure(config)).toBe(config)
  })

  it('declares App tools that run as codemode, never hidden or deferred ones', () => {
    const config = withOpenWaggleRuntimeExposure({
      command: 'apps-mcp',
      exposure: 'direct' as const,
      toolExposure: { 'secret*': 'hidden' as const, later: 'deferred' as const },
    })

    expect(withMcpAppToolsDeclared(config, ['show', 'secret-app', 'later', 'show'])).toEqual({
      command: 'apps-mcp',
      exposure: 'codemode',
      toolExposure: { 'secret*': 'hidden', later: 'deferred', show: 'direct' },
    })
  })

  it('declares nothing for a server without App tools, so it never delays a message', () => {
    const config = withOpenWaggleRuntimeExposure({ command: 'a', exposure: 'direct' as const })

    expect(withMcpAppToolsDeclared(config, [])).toBe(config)
  })
})
