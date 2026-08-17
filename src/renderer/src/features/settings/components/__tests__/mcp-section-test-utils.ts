import type { McpSettingsView } from '@shared/types/mcp'
import { type Mock, vi } from 'vitest'

type McpApiMockName =
  | 'getMcpSettings'
  | 'setMcpScopeState'
  | 'setMcpServerEnabled'
  | 'setMcpProjectServerEnabled'
  | 'setMcpServerTrust'
  | 'writeMcpSourceConfig'
  | 'removeMcpServer'
  | 'previewMcpImports'
  | 'applyMcpImports'
  | 'doctorMcp'
  | 'listMcpSecrets'
  | 'setMcpSecret'
  | 'removeMcpSecret'
  | 'listMcpCapabilities'
  | 'getMcpPrompt'
  | 'readMcpResource'
  | 'reviewMcpRemoteSkill'
  | 'operateMcpTask'
  | 'setMcpEventSubscription'
  | 'listMcpEvents'
  | 'listMcpEventSubscriptions'
  | 'prepareAttachmentFromText'
  | 'showConfirm'

export const apiMocks: Readonly<Record<McpApiMockName, Mock>> = {
  getMcpSettings: vi.fn(),
  setMcpScopeState: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  setMcpProjectServerEnabled: vi.fn(),
  setMcpServerTrust: vi.fn(),
  writeMcpSourceConfig: vi.fn(),
  removeMcpServer: vi.fn(),
  previewMcpImports: vi.fn(),
  applyMcpImports: vi.fn(),
  doctorMcp: vi.fn(),
  listMcpSecrets: vi.fn(),
  setMcpSecret: vi.fn(),
  removeMcpSecret: vi.fn(),
  listMcpCapabilities: vi.fn(),
  getMcpPrompt: vi.fn(),
  readMcpResource: vi.fn(),
  reviewMcpRemoteSkill: vi.fn(),
  operateMcpTask: vi.fn(),
  setMcpEventSubscription: vi.fn(),
  listMcpEvents: vi.fn(),
  listMcpEventSubscriptions: vi.fn(),
  prepareAttachmentFromText: vi.fn(),
  showConfirm: vi.fn(),
}

Object.defineProperty(window, 'api', { configurable: true, value: apiMocks })

export const PROJECT_PATH = '/tmp/openwaggle-project'
export const SESSION_ID = 'session-1'

export const MCP_VIEW = {
  integration: {
    desired: {
      global: 'on',
      project: 'on',
      session: 'inherit',
      effective: 'on',
      source: 'project',
    },
    applied: 'on',
    applyState: 'applied',
  },
  sources: [
    {
      id: 'global-openwaggle',
      label: 'Global OpenWaggle MCP',
      path: '/Users/test/.openwaggle/mcp.json',
      scope: 'global',
      kind: 'openwaggle',
      exists: false,
      editable: true,
      serverCount: 0,
      rawJson: '{\n  "mcpServers": {}\n}\n',
      ignoredFields: [],
    },
    {
      id: 'project-standard',
      label: 'Project standard MCP',
      path: `${PROJECT_PATH}/.mcp.json`,
      scope: 'project',
      kind: 'standard',
      exists: true,
      editable: true,
      serverCount: 1,
      rawJson: '{\n  "mcpServers": {\n    "playwright": { "command": "npx" }\n  }\n}\n',
      ignoredFields: [],
    },
    {
      id: 'project-openwaggle',
      label: 'Project OpenWaggle MCP',
      path: `${PROJECT_PATH}/.openwaggle/mcp.json`,
      scope: 'project',
      kind: 'openwaggle',
      exists: true,
      editable: true,
      serverCount: 1,
      rawJson: '{\n  "mcpServers": {\n    "alpha": { "command": "alpha" }\n  }\n}\n',
      ignoredFields: [],
    },
  ],
  servers: [
    {
      instanceId: 'mcp-server-alpha',
      name: 'alpha',
      enabled: true,
      projectEnabled: true,
      trusted: 'untrusted',
      required: false,
      sourceId: 'project-openwaggle',
      sourceLabel: 'Project OpenWaggle MCP',
      sourcePath: `${PROJECT_PATH}/.openwaggle/mcp.json`,
      configHash: 'alpha-hash',
      command: 'alpha',
      transport: 'stdio',
      compatibility: 'legacy-sse',
      directTools: 'inherited',
      auth: 'none',
      requestedPermissions: { readRoots: [], writeRoots: [], allowNetwork: false },
      connectionState: 'blocked',
      negotiatedProtocolVersion: '2024-11-05',
      capabilities: ['tools', 'resources'],
      blockedReason: 'Server has not been trusted.',
    },
  ],
  notices: [
    {
      id: 'server:mcp-server-alpha:blocked',
      severity: 'warning',
      title: 'alpha cannot start',
      detail: 'Server has not been trusted.',
      action: 'Review trust before the next turn.',
      serverInstanceId: 'mcp-server-alpha',
    },
  ],
  projectStates: {},
  projectPath: PROJECT_PATH,
  sessionId: SESSION_ID,
} satisfies McpSettingsView

export function resetMcpSectionTestState() {
  for (const mock of Object.values(apiMocks)) mock.mockReset()
  apiMocks.getMcpSettings.mockResolvedValue(MCP_VIEW)
  apiMocks.setMcpScopeState.mockResolvedValue(MCP_VIEW)
  apiMocks.setMcpServerEnabled.mockResolvedValue(MCP_VIEW)
  apiMocks.setMcpProjectServerEnabled.mockResolvedValue(MCP_VIEW)
  apiMocks.setMcpServerTrust.mockResolvedValue(MCP_VIEW)
  apiMocks.writeMcpSourceConfig.mockResolvedValue(MCP_VIEW)
  apiMocks.removeMcpServer.mockResolvedValue(MCP_VIEW)
  apiMocks.previewMcpImports.mockResolvedValue({ candidates: [], unavailableSources: ['pi'] })
  apiMocks.applyMcpImports.mockResolvedValue({ imported: [], skipped: [], view: MCP_VIEW })
  apiMocks.doctorMcp.mockResolvedValue({
    ok: true,
    checks: [{ id: 'runtime', status: 'pass', message: 'MCP runtime is ready.' }],
  })
  apiMocks.listMcpSecrets.mockResolvedValue([])
  apiMocks.setMcpSecret.mockResolvedValue([
    { name: 'GITHUB_TOKEN', createdAt: 1_786_300_000_000, updatedAt: 1_786_300_000_000 },
  ])
  apiMocks.removeMcpSecret.mockResolvedValue([])
  apiMocks.listMcpCapabilities.mockResolvedValue({
    instructions: [],
    prompts: [],
    resources: [],
    resourceTemplates: [],
    apps: [],
    tasks: [],
    skills: [],
  })
  apiMocks.getMcpPrompt.mockResolvedValue({
    messages: [],
    attribution: { serverInstanceId: 'mcp-server-alpha', serverLabel: 'alpha' },
  })
  apiMocks.operateMcpTask.mockResolvedValue([])
  apiMocks.setMcpEventSubscription.mockResolvedValue({
    serverInstanceId: 'mcp-server-alpha',
    serverLabel: 'alpha',
    active: true,
    mode: 'modern-listen',
    resourceUris: [],
    detail: 'Events stay in the inbox until selected.',
  })
  apiMocks.listMcpEvents.mockResolvedValue([])
  apiMocks.listMcpEventSubscriptions.mockResolvedValue([])
  apiMocks.showConfirm.mockResolvedValue(false)
}
