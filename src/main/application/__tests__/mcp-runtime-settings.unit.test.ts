import type { McpSettingsView } from '@shared/types/mcp'
import { describe, expect, it } from 'vitest'
import { mergeMcpRuntimeSettingsView } from '../mcp-runtime-settings'

const SETTINGS_VIEW: McpSettingsView = {
  integration: {
    desired: {
      global: 'on',
      project: 'inherit',
      session: 'inherit',
      effective: 'on',
      source: 'global',
    },
    applied: 'on',
    applyState: 'applied',
  },
  sources: [],
  servers: [
    {
      instanceId: 'server-1',
      name: 'docs',
      enabled: true,
      trusted: 'trusted',
      required: false,
      sourceId: 'project-standard',
      sourceLabel: 'Project MCP',
      sourcePath: '/project/.mcp.json',
      configHash: 'config-1',
      command: 'docs-mcp',
      transport: 'stdio',
      compatibility: 'auto',
      directTools: 'disabled',
      auth: 'none',
      requestedPermissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
      connectionState: 'disconnected',
      capabilities: [],
    },
  ],
  notices: [],
  projectPath: '/project',
  sessionId: 'session-1',
}

describe('MCP runtime settings projection', () => {
  it('merges the active connection, negotiated capabilities, and transparent runtime errors', () => {
    const view = mergeMcpRuntimeSettingsView({
      view: SETTINGS_VIEW,
      statuses: [
        {
          runtimeNamespace: 'mcp-management:session-1',
          sessionId: 'session-1',
          projectPath: '/project',
          snapshotRevision: 'management-revision',
          serverInstanceId: 'server-1',
          connectionState: 'connected',
          negotiatedProtocolVersion: '2025-11-25',
          capabilities: ['prompts'],
        },
        {
          runtimeNamespace: 'session-1',
          sessionId: 'session-1',
          projectPath: '/project',
          snapshotRevision: 'active-revision',
          serverInstanceId: 'server-1',
          connectionState: 'connected',
          negotiatedProtocolVersion: '2026-07-28',
          capabilities: ['tools', 'resources'],
        },
      ],
      runtimeNotices: [
        {
          id: 'runtime:server-1:capabilities',
          severity: 'warning',
          title: 'docs MCP capabilities could not be loaded',
          detail: 'resources/list timed out',
          serverInstanceId: 'server-1',
        },
      ],
    })

    expect(view.servers[0]).toMatchObject({
      connectionState: 'degraded',
      negotiatedProtocolVersion: '2026-07-28',
      capabilities: ['tools', 'resources'],
      lastError: 'resources/list timed out',
    })
    expect(view.notices).toEqual([expect.objectContaining({ id: 'runtime:server-1:capabilities' })])
  })
})
