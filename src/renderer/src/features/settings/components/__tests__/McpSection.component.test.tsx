import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  apiMocks,
  MCP_VIEW,
  PROJECT_PATH,
  resetMcpSectionTestState,
  SESSION_ID,
} from './mcp-section-test-utils'

const { McpSection } = await import('../sections/McpSection')
const { usePreferencesStore } = await import('@/features/settings/state/preferences-store')
const { useComposerStore } = await import('@/features/composer/state')
const { useUIStore } = await import('@/shell/ui-store')

describe('McpSection', () => {
  beforeEach(() => {
    resetMcpSectionTestState()
    useUIStore.getState().clearToast()
    useComposerStore.setState({ input: '', attachments: [], lexicalEditor: null, cursorIndex: 0 })
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH },
      isLoaded: true,
      loadError: null,
    })
  })

  it('shows the effective activation scope and legacy protocol state transparently', async () => {
    render(<McpSection sessionId={SESSION_ID} />)

    expect(await screen.findByText('Project OpenWaggle MCP')).toBeInTheDocument()
    expect(screen.getByText('Effective source')).toBeInTheDocument()
    expect(screen.getByText('Legacy compatibility')).toBeInTheDocument()
    expect(screen.getByText(/MCP 2024-11-05/)).toBeInTheDocument()
    expect(screen.getByText('alpha cannot start')).toBeInTheDocument()
    expect(screen.getByText(/Pi's tool-capable model contract/)).toBeInTheDocument()
    expect(apiMocks.getMcpSettings).toHaveBeenCalledWith({
      projectPath: PROJECT_PATH,
      sessionId: SESSION_ID,
    })
  })

  it('sets a session override independently from project and global state', async () => {
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Set Session scope to Off' }))

    await waitFor(() => {
      expect(apiMocks.setMcpScopeState).toHaveBeenCalledWith({
        projectPath: PROJECT_PATH,
        sessionId: SESSION_ID,
        scope: 'session',
        state: 'off',
      })
    })
  })

  it('previews and imports legacy global and project Pi MCP definitions explicitly', async () => {
    apiMocks.previewMcpImports.mockResolvedValueOnce({
      candidates: [
        {
          source: 'pi',
          sourcePath: '/Users/test/.pi/agent/mcp.json',
          suggestedTarget: 'global',
          name: 'global-docs',
          definition: { command: 'global-docs-mcp' },
          fingerprint: 'global-fingerprint',
          warnings: [],
        },
        {
          source: 'pi',
          sourcePath: `${PROJECT_PATH}/.mcp.json`,
          suggestedTarget: 'project',
          name: 'disabled-browser',
          definition: { command: 'browser-mcp' },
          fingerprint: 'project-fingerprint',
          warnings: ['The source server is disabled. OpenWaggle imports it disabled.'],
        },
      ],
      unavailableSources: [],
    })
    apiMocks.applyMcpImports.mockResolvedValue({
      imported: [
        {
          source: 'pi',
          sourceName: 'server',
          targetName: 'server',
          fingerprint: 'fingerprint',
        },
      ],
      skipped: [],
      view: MCP_VIEW,
    })
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Scan legacy MCP configs' }))

    expect(
      await screen.findByText('Found 2 legacy MCP server definitions for review.'),
    ).toBeInTheDocument()
    expect(apiMocks.previewMcpImports).toHaveBeenCalledWith({
      projectPath: PROJECT_PATH,
      sources: ['pi'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 legacy servers' }))
    await waitFor(() => expect(apiMocks.applyMcpImports).toHaveBeenCalledTimes(2))
    expect(apiMocks.applyMcpImports).toHaveBeenNthCalledWith(1, {
      projectPath: PROJECT_PATH,
      sources: ['pi'],
      fingerprints: ['global-fingerprint'],
      target: 'global',
      conflictPolicy: 'skip',
    })
    expect(apiMocks.applyMcpImports).toHaveBeenNthCalledWith(2, {
      projectPath: PROJECT_PATH,
      sources: ['pi'],
      fingerprints: ['project-fingerprint'],
      target: 'project',
      conflictPolicy: 'skip',
    })
    expect(await screen.findByText(/Imported 2 legacy MCP server definitions/)).toBeInTheDocument()
  })

  it('toggles and trusts the stable server instance', async () => {
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Disable alpha' }))
    await waitFor(() => {
      expect(apiMocks.setMcpServerEnabled).toHaveBeenCalledWith({
        projectPath: PROJECT_PATH,
        sessionId: SESSION_ID,
        instanceId: 'mcp-server-alpha',
        enabled: false,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Review & trust' }))
    expect(screen.getByText('No project paths')).toBeInTheDocument()
    expect(screen.getByText('Isolated temporary space only')).toBeInTheDocument()
    expect(screen.getByText('Denied')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve permissions and trust' }))
    await waitFor(() => {
      expect(apiMocks.setMcpServerTrust).toHaveBeenCalledWith({
        projectPath: PROJECT_PATH,
        sessionId: SESSION_ID,
        instanceId: 'mcp-server-alpha',
        trusted: true,
        permissions: { readRoots: [], writeRoots: [], allowNetwork: false },
      })
    })
  })

  it('writes raw JSON to the selected source', async () => {
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: /Project standard MCP/i }))
    fireEvent.change(screen.getByRole('textbox', { name: 'MCP source JSON' }), {
      target: { value: '{\n  "mcpServers": {}\n}\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save JSON' }))

    await waitFor(() => {
      expect(apiMocks.writeMcpSourceConfig).toHaveBeenCalledWith({
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

  it('stores a named secret without ever reading its value back', async () => {
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'MCP secret name' }), {
      target: { value: 'GITHUB_TOKEN' },
    })
    fireEvent.change(screen.getByLabelText('MCP secret value'), {
      target: { value: 'secret-value' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }))

    await waitFor(() => {
      expect(apiMocks.setMcpSecret).toHaveBeenCalledWith({
        name: 'GITHUB_TOKEN',
        value: 'secret-value',
      })
    })
    expect(await screen.findByText('GITHUB_TOKEN')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('secret-value')).not.toBeInTheDocument()
  })

  it('reports source write failures and preserves the next user action', async () => {
    apiMocks.writeMcpSourceConfig.mockRejectedValueOnce(new Error('Invalid JSON'))
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: /Project standard MCP/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save JSON' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid JSON')
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'MCP JSON was not saved: Invalid JSON',
      variant: 'error',
    })
  })

  it('loads prompts lazily and creates an attributed editable composer draft', async () => {
    apiMocks.listMcpCapabilities.mockResolvedValueOnce({
      instructions: [],
      prompts: [
        {
          serverInstanceId: 'mcp-server-alpha',
          serverLabel: 'alpha',
          name: 'review',
          description: 'Review a change',
          arguments: [{ name: 'focus', required: true }],
        },
      ],
      resources: [],
      resourceTemplates: [],
      apps: [],
      tasks: [],
      skills: [],
    })
    apiMocks.getMcpPrompt.mockResolvedValueOnce({
      description: 'Review a change',
      messages: [{ role: 'user', content: { type: 'text', text: 'Review security boundaries.' } }],
      attribution: { serverInstanceId: 'mcp-server-alpha', serverLabel: 'alpha' },
    })
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load capabilities' }))
    expect(await screen.findByText('Review a change')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('focus · required'), { target: { value: 'security' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create editable draft' }))

    await waitFor(() => {
      expect(apiMocks.getMcpPrompt).toHaveBeenCalledWith({
        projectPath: PROJECT_PATH,
        sessionId: SESSION_ID,
        serverInstanceId: 'mcp-server-alpha',
        name: 'review',
        arguments: { focus: 'security' },
      })
    })
    expect(useComposerStore.getState().input).toContain('MCP prompt from alpha')
    expect(useComposerStore.getState().input).toContain('Review security boundaries.')
  })

  it('keeps Event Inbox subscriptions opt-in and events out of context until selected', async () => {
    apiMocks.getMcpSettings.mockResolvedValueOnce({
      ...MCP_VIEW,
      servers: MCP_VIEW.servers.map((server) => ({
        ...server,
        trusted: 'trusted' as const,
        connectionState: 'connected' as const,
        blockedReason: undefined,
      })),
    })
    apiMocks.listMcpEvents.mockResolvedValue([
      {
        id: 'event-1',
        sessionId: SESSION_ID,
        serverInstanceId: 'mcp-server-alpha',
        serverLabel: 'alpha',
        kind: 'resource-updated',
        receivedAt: 1_786_300_000_000,
        payload: { uri: 'docs://readme' },
        read: false,
      },
    ])
    render(<McpSection sessionId={SESSION_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open inbox' }))
    expect(await screen.findByText('resource-updated')).toBeInTheDocument()
    expect(apiMocks.setMcpEventSubscription).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Start events' }))
    await waitFor(() => {
      expect(apiMocks.setMcpEventSubscription).toHaveBeenCalledWith({
        projectPath: PROJECT_PATH,
        sessionId: SESSION_ID,
        serverInstanceId: 'mcp-server-alpha',
        enabled: true,
        resourceUris: [],
      })
    })

    expect(useComposerStore.getState().input).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Add to editable draft' }))
    expect(useComposerStore.getState().input).toContain('MCP event from alpha')
    expect(useComposerStore.getState().input).toContain('docs://readme')
  })
})
