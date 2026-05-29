import { MCP_ADAPTER_PACKAGE_SOURCE } from '@shared/constants/mcp'
import type { McpSettingsView } from '@shared/types/mcp'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getMcpSettingsMock,
  setMcpAdapterEnabledMock,
  setMcpServerEnabledMock,
  writeMcpSourceConfigMock,
} = vi.hoisted(() => ({
  getMcpSettingsMock: vi.fn(),
  setMcpAdapterEnabledMock: vi.fn(),
  setMcpServerEnabledMock: vi.fn(),
  writeMcpSourceConfigMock: vi.fn(),
}))

Object.defineProperty(window, 'api', {
  configurable: true,
  value: {
    getMcpSettings: getMcpSettingsMock,
    setMcpAdapterEnabled: setMcpAdapterEnabledMock,
    setMcpServerEnabled: setMcpServerEnabledMock,
    writeMcpSourceConfig: writeMcpSourceConfigMock,
  },
})

const { McpSection } = await import('../sections/McpSection')
const { usePreferencesStore } = await import('@/features/settings/state/preferences-store')
const { useUIStore } = await import('@/shell/ui-store')

const PROJECT_PATH = '/tmp/openwaggle-project'

const MCP_VIEW = {
  adapter: {
    enabled: true,
    packageSource: MCP_ADAPTER_PACKAGE_SOURCE,
    runtimeConfigPath: '/tmp/pi-agent/openwaggle-mcp/project/mcp.json',
  },
  sources: [
    {
      id: 'global-standard',
      label: 'Global standard MCP',
      path: '/Users/test/.config/mcp/mcp.json',
      scope: 'global',
      kind: 'standard',
      exists: false,
      editable: true,
      serverCount: 0,
      disabledServerCount: 0,
      rawJson: '{\n  "mcpServers": {}\n}\n',
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
      disabledServerCount: 0,
      rawJson: '{\n  "mcpServers": {\n    "playwright": { "command": "npx" }\n  }\n}\n',
    },
    {
      id: 'project-openwaggle',
      label: 'Project OpenWaggle MCP',
      path: `${PROJECT_PATH}/.openwaggle/agent/mcp.json`,
      scope: 'project',
      kind: 'openwaggle',
      exists: true,
      editable: true,
      serverCount: 1,
      disabledServerCount: 0,
      rawJson: '{\n  "mcpServers": {\n    "alpha": { "command": "alpha" }\n  }\n}\n',
    },
  ],
  effective: {
    mcpServers: {
      playwright: { command: 'npx' },
      alpha: { command: 'alpha' },
    },
    disabledMcpServers: {},
    settings: {},
    imports: [],
  },
  servers: [
    {
      name: 'alpha',
      enabled: true,
      sourceId: 'project-openwaggle',
      sourceLabel: 'Project OpenWaggle MCP',
      sourcePath: `${PROJECT_PATH}/.openwaggle/agent/mcp.json`,
      command: 'alpha',
      transport: 'stdio',
      directTools: 'inherited',
    },
  ],
  runtimeConfigPath: '/tmp/pi-agent/openwaggle-mcp/project/mcp.json',
} satisfies McpSettingsView

function sourceAt(index: number) {
  const source = MCP_VIEW.sources[index]
  if (!source) {
    throw new Error(`Expected MCP view source at index ${String(index)}`)
  }
  return source
}

describe('McpSection', () => {
  beforeEach(() => {
    getMcpSettingsMock.mockReset()
    setMcpAdapterEnabledMock.mockReset()
    setMcpServerEnabledMock.mockReset()
    writeMcpSourceConfigMock.mockReset()

    getMcpSettingsMock.mockResolvedValue(MCP_VIEW)
    setMcpAdapterEnabledMock.mockResolvedValue({
      ...MCP_VIEW,
      adapter: { ...MCP_VIEW.adapter, enabled: false },
    } satisfies McpSettingsView)
    setMcpServerEnabledMock.mockResolvedValue(MCP_VIEW)
    writeMcpSourceConfigMock.mockResolvedValue(MCP_VIEW)
    useUIStore.getState().clearToast()

    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: PROJECT_PATH,
      },
      isLoaded: true,
      loadError: null,
    })
  })

  it('renders the effective MCP sources with the OpenWaggle project config path', async () => {
    render(<McpSection />)

    expect(await screen.findByText('Project OpenWaggle MCP')).toBeInTheDocument()
    expect(screen.getByText(`${PROJECT_PATH}/.openwaggle/agent/mcp.json`)).toBeInTheDocument()
    expect(screen.getByText(/Runtime bridge config:/)).toBeInTheDocument()
  })

  it('toggles only the effective source entry for a server', async () => {
    render(<McpSection />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Disable alpha' }))

    await waitFor(() => {
      expect(setMcpServerEnabledMock).toHaveBeenCalledWith({
        projectPath: PROJECT_PATH,
        sourceId: 'project-openwaggle',
        serverName: 'alpha',
        enabled: false,
      })
    })
  })

  it('writes raw JSON to the selected edit target', async () => {
    render(<McpSection />)

    fireEvent.click(await screen.findByRole('button', { name: /Project standard MCP/i }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{\n  "mcpServers": {}\n}\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save JSON' }))

    await waitFor(() => {
      expect(writeMcpSourceConfigMock).toHaveBeenCalledWith({
        projectPath: PROJECT_PATH,
        sourceId: 'project-standard',
        rawJson: '{\n  "mcpServers": {}\n}\n',
      })
    })

    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'MCP JSON saved.',
      variant: 'success',
    })
  })

  it('notifies when saving raw JSON fails', async () => {
    writeMcpSourceConfigMock.mockRejectedValueOnce(new Error('Invalid JSON'))

    render(<McpSection />)

    fireEvent.click(await screen.findByRole('button', { name: /Project standard MCP/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save JSON' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid JSON')
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'MCP JSON was not saved: Invalid JSON',
      variant: 'error',
    })
  })

  it('disables the adapter package source without touching server config from the renderer', async () => {
    render(<McpSection />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Disable Pi MCP extension' }))

    await waitFor(() => {
      expect(setMcpAdapterEnabledMock).toHaveBeenCalledWith(false, PROJECT_PATH)
    })
  })

  it('shows invalid source diagnostics returned by the main process', async () => {
    getMcpSettingsMock.mockResolvedValueOnce({
      ...MCP_VIEW,
      sources: [
        {
          ...sourceAt(0),
          exists: true,
          parseError: 'Invalid MCP JSON config at /Users/test/.config/mcp/mcp.json',
        },
        ...MCP_VIEW.sources.slice(1),
      ],
      adapter: {
        ...MCP_VIEW.adapter,
        lastError: 'Invalid Pi settings JSON at /Users/test/.pi/settings.json',
      },
    } satisfies McpSettingsView)

    render(<McpSection />)

    expect(await screen.findByText('Invalid')).toBeInTheDocument()
    expect(
      screen.getAllByText('Invalid MCP JSON config at /Users/test/.config/mcp/mcp.json'),
    ).toHaveLength(2)
    expect(
      screen.getByText('Invalid Pi settings JSON at /Users/test/.pi/settings.json'),
    ).toBeInTheDocument()
  })
})
