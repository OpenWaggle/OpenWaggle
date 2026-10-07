import type { McpServerInspection } from '@shared/types/mcp-configuration'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  inspectMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  setMcpServerExposure: vi.fn(),
  addMcpServer: vi.fn(),
  removeMcpServer: vi.fn(),
  installMcpCatalogServer: vi.fn(),
  signInMcpServer: vi.fn(),
  signOutMcpServer: vi.fn(),
  previewMcpImports: vi.fn(),
  applyMcpImports: vi.fn(),
  listMcpSecrets: vi.fn(),
  setMcpSecret: vi.fn(),
  removeMcpSecret: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpServersPanel } from '../McpServersPanel'

const INSPECTIONS: Readonly<Record<string, McpServerInspection>> = {
  sentry: { name: 'sentry', state: 'needs-sign-in', tools: [] },
  broken: {
    name: 'broken',
    state: 'failed',
    tools: [],
    error: 'spawn tools-mcp ENOENT',
    stderrTail: 'npm error 404 Not Found',
  },
  github: {
    name: 'github',
    state: 'connected',
    tools: [
      { name: 'search_code', exposure: 'direct', hasApp: false, description: 'Search code' },
      { name: 'get_issue', exposure: 'codemode', hasApp: false },
    ],
  },
}

const SERVERS = [
  mcpServer('github', {
    transport: 'http',
    target: 'https://api.githubcopilot.com/mcp/',
    toolExposure: { search_code: 'direct', 'delete_*': 'hidden' },
  }),
  mcpServer('off', {
    enabled: false,
    source: { fileId: 'openwaggle-global', path: '/Users/me/.openwaggle/mcp.json' },
  }),
  mcpServer('sentry', { transport: 'http', target: 'https://mcp.sentry.dev/mcp', usesOAuth: true }),
  mcpServer('broken'),
]

function renderPanel() {
  return renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)
}

async function openServer(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Open ${name}` }))
}

describe('Settings > MCP servers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpConfiguration.mockResolvedValue(mcpView(SERVERS))
    api.inspectMcpServer.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve(INSPECTIONS[name]),
    )
    api.listMcpSecrets.mockResolvedValue([])
  })

  it('lists servers that need attention first, with their state, file, tools, and exposure', async () => {
    renderPanel()

    await waitFor(() => expect(screen.getByText('Needs sign-in')).toBeInTheDocument())
    await screen.findByText('2 tools')
    const list = screen.getByRole('list', { name: 'MCP servers' })
    const names = within(list)
      .getAllByRole('button')
      .map((row) => row.getAttribute('aria-label'))
    expect(names).toEqual(['Open sentry', 'Open broken', 'Open github', 'Open off'])
    const github = within(list).getByRole('button', { name: 'Open github' })
    expect(within(github).getByText('Connected')).toBeInTheDocument()
    expect(within(github).getByText('Pi, all projects')).toBeInTheDocument()
    expect(within(github).getByText('~/.pi/agent/mcp.json')).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Open off' })).toHaveTextContent('Off')
    expect(api.inspectMcpServer).not.toHaveBeenCalledWith({ projectPath: PROJECT, name: 'off' })
  })

  it('shows configuration errors as Pi reports them', async () => {
    api.getMcpConfiguration.mockResolvedValue(
      mcpView([], ['/Users/me/.pi/agent/mcp.json: "bad name!": invalid server name']),
    )
    renderPanel()

    expect(
      await screen.findByText('/Users/me/.pi/agent/mcp.json: "bad name!": invalid server name'),
    ).toBeInTheDocument()
  })

  it('shows a failed server’s error and the tail of its output', async () => {
    renderPanel()
    await openServer('broken')

    expect(await screen.findByText('spawn tools-mcp ENOENT')).toBeInTheDocument()
    expect(screen.getByText('npm error 404 Not Found')).toBeInTheDocument()
  })

  it('shows a server the runtime cannot reach yet as not connected', async () => {
    api.inspectMcpServer.mockResolvedValue({
      name: 'broken',
      state: 'not-connected',
      tools: [],
      error: 'Connecting to MCP servers is not available in this build yet.',
    })
    renderPanel()
    await openServer('broken')

    expect(await screen.findByText('Not connected')).toBeInTheDocument()
    expect(screen.getByText('Tools appear here once the server connects.')).toBeInTheDocument()
  })

  it('turns a global server off for this project only', async () => {
    api.setMcpServerEnabled.mockResolvedValue(mcpView(SERVERS))
    renderPanel()
    await openServer('broken')

    fireEvent.click(await screen.findByRole('button', { name: 'Turn off in this project' }))

    await waitFor(() =>
      expect(api.setMcpServerEnabled).toHaveBeenCalledWith({
        projectPath: PROJECT,
        name: 'broken',
        enabled: false,
        target: 'project',
      }),
    )
  })

  it('hides the project switch once a project file overrides the server', async () => {
    api.getMcpConfiguration.mockResolvedValue(
      mcpView([
        mcpServer('broken', {
          enabled: false,
          override: { fileId: 'project-openwaggle', path: `${PROJECT}/.openwaggle/mcp.json` },
        }),
      ]),
    )
    renderPanel()
    await openServer('broken')

    expect(await screen.findByText(/Applies to this project/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /in this project/ })).not.toBeInTheDocument()
  })

  it('edits server and per-tool exposure with plain explanations', async () => {
    api.setMcpServerExposure.mockResolvedValue(mcpView(SERVERS))
    renderPanel()
    await openServer('github')

    const exposure = await screen.findByRole('radiogroup', { name: 'Server exposure' })
    expect(within(exposure).getByRole('radio', { name: /Codemode/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(
      within(exposure).getByText(
        'Shown to the model like built-in tools, and callable from codemode.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(within(exposure).getByRole('radio', { name: /Deferred/ }))
    await waitFor(() =>
      expect(api.setMcpServerExposure).toHaveBeenCalledWith({
        projectPath: PROJECT,
        name: 'github',
        exposure: 'deferred',
      }),
    )

    const settle = async (calls: number) => {
      await waitFor(() => expect(api.setMcpServerExposure).toHaveBeenCalledTimes(calls))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Remove rule delete_*' })).toBeEnabled(),
      )
    }
    await settle(1)
    fireEvent.change(screen.getByRole('combobox', { name: 'Exposure of get_issue' }), {
      target: { value: 'hidden' },
    })
    await settle(2)
    fireEvent.change(screen.getByRole('combobox', { name: 'Exposure of search_code' }), {
      target: { value: 'server' },
    })
    await settle(3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule delete_*' }))
    await waitFor(() => expect(api.setMcpServerExposure).toHaveBeenCalledTimes(4))
    expect(
      api.setMcpServerExposure.mock.calls.slice(1).map((call) => call[0].toolExposure),
    ).toEqual([{ get_issue: 'hidden' }, { search_code: null }, { 'delete_*': null }])
  })

  it('signs in to an OAuth server and shows the page when it could not be opened', async () => {
    api.signInMcpServer.mockResolvedValue({
      signedIn: false,
      authorizationUrl: 'https://auth.example/authorize',
    })
    renderPanel()
    await openServer('sentry')

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('https://auth.example/authorize')).toBeInTheDocument()
    expect(api.signInMcpServer).toHaveBeenCalledWith({ projectPath: PROJECT, name: 'sentry' })
  })

  it('removes a server after confirmation and returns to the list', async () => {
    api.removeMcpServer.mockResolvedValue(
      mcpView(SERVERS.filter((server) => server.name !== 'broken')),
    )
    renderPanel()
    await openServer('broken')

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(screen.getByText('Remove broken from Pi, all projects?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove server' }))

    await screen.findByRole('list', { name: 'MCP servers' })
    expect(api.removeMcpServer).toHaveBeenCalledWith({ projectPath: PROJECT, name: 'broken' })
    expect(screen.queryByRole('button', { name: 'Open broken' })).not.toBeInTheDocument()
  })

  it('never talks about trust, sandboxes, grants, or a global MCP switch', async () => {
    const { container } = renderPanel()
    await screen.findByText('2 tools')
    await openServer('github')
    await screen.findByRole('radiogroup', { name: 'Server exposure' })

    expect(container.textContent).not.toMatch(/trust|sandbox|grant|gateway|MCP off/i)
  })
})
