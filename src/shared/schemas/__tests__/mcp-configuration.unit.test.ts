import { safeDecodeUnknown } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import {
  mcpAddServerRequestSchema,
  mcpImportApplyRequestSchema,
  mcpSetServerEnabledRequestSchema,
  mcpSetServerExposureRequestSchema,
} from '../mcp-configuration'

describe('MCP configuration request schemas', () => {
  it('keeps every key of a Pi entry, including ones OpenWaggle does not list', () => {
    const entry = {
      url: 'https://mcp.example/mcp',
      timeout: 30,
      oauth: { clientRegistration: 'cimd', scope: 'read write' },
      headers: { 'X-Api-Version': '2' },
      futureField: [1, true, null],
    }

    const decoded = safeDecodeUnknown(mcpAddServerRequestSchema, {
      projectPath: null,
      name: 'example',
      scope: 'global',
      entry,
    })

    expect(decoded).toEqual({
      success: true,
      data: { projectPath: null, name: 'example', scope: 'global', entry },
    })
  })

  it('rejects an entry value that is not JSON', () => {
    const decoded = safeDecodeUnknown(mcpAddServerRequestSchema, {
      projectPath: null,
      name: 'example',
      scope: 'global',
      entry: { command: () => 'npx' },
    })

    expect(decoded.success).toBe(false)
  })

  it('accepts a per-tool exposure removal and rejects an unknown exposure', () => {
    expect(
      safeDecodeUnknown(mcpSetServerExposureRequestSchema, {
        projectPath: '/project',
        name: 'github',
        toolExposure: { 'get_*': 'codemode', delete_repo: null },
      }).success,
    ).toBe(true)
    expect(
      safeDecodeUnknown(mcpSetServerExposureRequestSchema, {
        projectPath: '/project',
        name: 'github',
        exposure: 'codemode-deferred',
      }).success,
    ).toBe(false)
  })

  it('accepts only the five MCP files as a destination', () => {
    const base = { projectPath: '/project', name: 'docs', enabled: false, target: 'project' }

    expect(
      safeDecodeUnknown(mcpSetServerEnabledRequestSchema, {
        ...base,
        destination: 'project-pi',
      }).success,
    ).toBe(true)
    expect(
      safeDecodeUnknown(mcpSetServerEnabledRequestSchema, {
        ...base,
        destination: '/etc/mcp.json',
      }).success,
    ).toBe(false)
  })

  it('requires a conflict policy and a known source to apply imports', () => {
    const base = { projectPath: null, fingerprints: ['abc'], target: 'global' }

    expect(
      safeDecodeUnknown(mcpImportApplyRequestSchema, { ...base, conflictPolicy: 'rename' }).success,
    ).toBe(true)
    expect(safeDecodeUnknown(mcpImportApplyRequestSchema, base).success).toBe(false)
    expect(
      safeDecodeUnknown(mcpImportApplyRequestSchema, {
        ...base,
        conflictPolicy: 'skip',
        sources: ['pi'],
      }).success,
    ).toBe(false)
  })
})
