import type { McpSettingsView } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { runMcpManagementCommand } from '../mcp-cli-management'
import type { McpCliManagementRuntime } from '../mcp-cli-management-runtime'

const PROJECT_PATH = '/project'
const view: McpSettingsView = {
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
  sources: [
    {
      id: 'project-standard',
      label: 'Project MCP',
      path: '/project/.mcp.json',
      scope: 'project',
      kind: 'standard',
      exists: true,
      editable: true,
      serverCount: 1,
      rawJson: JSON.stringify({
        mcpServers: {
          'private-docs': {
            url: 'https://docs.example.com/mcp',
            auth: { type: 'oauth' },
          },
        },
      }),
      ignoredFields: [],
    },
  ],
  servers: [
    {
      instanceId: 'server-1',
      name: 'private-docs',
      enabled: true,
      projectEnabled: true,
      trusted: 'trusted',
      required: false,
      sourceId: 'project-standard',
      sourceLabel: 'Project MCP',
      sourcePath: '/project/.mcp.json',
      configHash: 'config-1',
      url: 'https://docs.example.com/mcp',
      transport: 'streamable-http',
      compatibility: 'auto',
      directTools: 'disabled',
      auth: 'oauth',
      requestedPermissions: { readRoots: [], writeRoots: [], allowNetwork: true },
      connectionState: 'disconnected',
      capabilities: [],
    },
  ],
  notices: [],
  projectStates: {},
  projectPath: PROJECT_PATH,
  sessionId: null,
}

function runtime(): McpCliManagementRuntime {
  return {
    service: {
      getView: vi.fn(async () => view),
      setScopeState: vi.fn(async () => view),
      setServerEnabled: vi.fn(async () => view),
      setProjectServerEnabled: vi.fn(async () => view),
      setServerTrust: vi.fn(async () => view),
      writeSourceConfig: vi.fn(async () => view),
      removeServer: vi.fn(async () => view),
      addServer: vi.fn(async () => view),
      previewImports: vi.fn(async () => ({ candidates: [], unavailableSources: [] })),
      applyImports: vi.fn(async () => ({ imported: [], skipped: [], view })),
    },
    vault: {
      list: vi.fn(async () => []),
      set: vi.fn(async () => []),
      remove: vi.fn(async () => []),
    },
    authorizeServer: vi.fn(async () => ({ authorized: true, browserOpened: true })),
    logoutServer: vi.fn(async () => ({ oauthRemoved: true })),
    dispose: vi.fn(async () => undefined),
  }
}

describe('runMcpManagementCommand', () => {
  let owner: McpCliManagementRuntime
  let createRuntime: ReturnType<typeof vi.fn<(args: unknown) => Promise<McpCliManagementRuntime>>>

  beforeEach(() => {
    owner = runtime()
    createRuntime = vi.fn(async () => owner)
  })

  it('reads settings through the Session Host owner', async () => {
    const result = await runMcpManagementCommand(
      'list',
      parseMcpCliArguments(['--project', PROJECT_PATH]),
      { createRuntime },
    )

    expect(result).toBe(view)
    expect(owner.service.getView).toHaveBeenCalledWith({ projectPath: PROJECT_PATH })
  })

  it('routes durable server additions through the owner runtime', async () => {
    await runMcpManagementCommand(
      'add',
      parseMcpCliArguments([
        'docs',
        '--url',
        'https://docs.example.com/mcp',
        '--scope',
        'global',
        '--project',
        PROJECT_PATH,
      ]),
      { createRuntime },
    )

    expect(owner.service.addServer).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: PROJECT_PATH,
        name: 'docs',
        target: 'global',
      }),
    )
  })

  it('does not mutate when the current-revision owner cannot be acquired', async () => {
    createRuntime.mockRejectedValueOnce(new Error('Host upgrade is still draining'))

    await expect(
      runMcpManagementCommand(
        'remove',
        parseMcpCliArguments(['private-docs', '--project', PROJECT_PATH]),
        { createRuntime },
      ),
    ).rejects.toThrow('Host upgrade is still draining')

    expect(owner.service.removeServer).not.toHaveBeenCalled()
  })

  it('runs OAuth and logout inside the owning Host', async () => {
    const args = parseMcpCliArguments(['private-docs', '--project', PROJECT_PATH])

    await expect(runMcpManagementCommand('auth', args, { createRuntime })).resolves.toEqual({
      authorized: true,
      browserOpened: true,
    })
    await runMcpManagementCommand('logout', args, { createRuntime })

    const expected = { projectPath: PROJECT_PATH, instanceId: 'server-1' }
    expect(owner.authorizeServer).toHaveBeenCalledWith(expected)
    expect(owner.logoutServer).toHaveBeenCalledWith(expected)
  })
})
