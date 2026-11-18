import { safeDecodeUnknown } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import {
  mcpRegistryInstallRequestSchema,
  mcpRegistrySearchRequestSchema,
  mcpRegistryServerRequestSchema,
} from '../mcp-registry'

describe('MCP Registry request schemas', () => {
  it('decodes an install for one project with a chosen package and name', () => {
    const request = {
      projectPath: '/work/app',
      registryName: 'io.github.example/weather',
      version: '2.0.0',
      scope: 'project',
      method: 'npm',
      serverName: 'weather',
      exposure: 'deferred',
    }

    expect(safeDecodeUnknown(mcpRegistryInstallRequestSchema, request)).toEqual({
      success: true,
      data: request,
    })
  })

  it.each([
    ['an unknown install method', { method: 'cargo' }],
    ['an unknown scope', { scope: 'everywhere' }],
    ['an empty server name', { serverName: '' }],
  ])('rejects %s', (_label, change) => {
    const decoded = safeDecodeUnknown(mcpRegistryInstallRequestSchema, {
      projectPath: null,
      registryName: 'io.github.example/weather',
      scope: 'global',
      ...change,
    })

    expect(decoded.success).toBe(false)
  })

  it('carries no trust decision into the install', () => {
    const decoded = safeDecodeUnknown(mcpRegistryInstallRequestSchema, {
      projectPath: null,
      registryName: 'io.github.example/weather',
      scope: 'global',
      trust: 'approved',
    })

    expect(decoded).toEqual({
      success: true,
      data: { projectPath: null, registryName: 'io.github.example/weather', scope: 'global' },
    })
  })

  it('bounds search results and requires a server name for a lookup', () => {
    expect(safeDecodeUnknown(mcpRegistrySearchRequestSchema, { query: 'weather' }).success).toBe(
      true,
    )
    expect(
      safeDecodeUnknown(mcpRegistrySearchRequestSchema, { query: 'weather', limit: 1000 }).success,
    ).toBe(false)
    expect(safeDecodeUnknown(mcpRegistryServerRequestSchema, { registryName: '' }).success).toBe(
      false,
    )
  })
})
