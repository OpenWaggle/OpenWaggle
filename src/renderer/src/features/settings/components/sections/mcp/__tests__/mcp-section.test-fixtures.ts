import type {
  McpConfigFileView,
  McpConfigurationView,
  McpConfiguredServerView,
} from '@shared/types/mcp-configuration'

export const PROJECT = '/tmp/mcp-project'

export const FILES: readonly McpConfigFileView[] = [
  {
    fileId: 'pi-global',
    path: '/Users/me/.pi/agent/mcp.json',
    scope: 'global',
    exists: true,
    openWaggleOwned: false,
  },
  {
    fileId: 'openwaggle-global',
    path: '/Users/me/.openwaggle/mcp.json',
    scope: 'global',
    exists: true,
    openWaggleOwned: true,
  },
  {
    fileId: 'project-mcp-json',
    path: `${PROJECT}/.mcp.json`,
    scope: 'project',
    exists: false,
    openWaggleOwned: false,
  },
  {
    fileId: 'project-pi',
    path: `${PROJECT}/.pi/mcp.json`,
    scope: 'project',
    exists: false,
    openWaggleOwned: false,
  },
  {
    fileId: 'project-openwaggle',
    path: `${PROJECT}/.openwaggle/mcp.json`,
    scope: 'project',
    exists: false,
    openWaggleOwned: true,
  },
]

export function mcpServer(
  name: string,
  overrides: Partial<McpConfiguredServerView> = {},
): McpConfiguredServerView {
  return {
    name,
    transport: 'stdio',
    target: `npx ${name}-mcp`,
    source: { fileId: 'pi-global', path: '/Users/me/.pi/agent/mcp.json' },
    scope: 'global',
    enabled: true,
    exposure: 'codemode',
    toolExposure: {},
    usesOAuth: false,
    ...overrides,
  }
}

export function mcpView(
  servers: readonly McpConfiguredServerView[],
  errors: readonly string[] = [],
): McpConfigurationView {
  return { projectPath: PROJECT, files: FILES, servers, errors }
}
