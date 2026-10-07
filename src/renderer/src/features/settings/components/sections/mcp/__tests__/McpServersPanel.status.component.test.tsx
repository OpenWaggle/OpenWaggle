import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { lastChecked, mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  inspectMcpServer: vi.fn(),
  listMcpSecrets: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpServersPanel } from '../McpServersPanel'

const SERVERS = [mcpServer('docs'), mcpServer('files')]

function renderPanel() {
  return renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)
}

describe('Settings > MCP server state', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpConfiguration.mockResolvedValue(mcpView(SERVERS))
    api.getMcpServerStatuses.mockResolvedValue([
      { name: 'docs', source: 'not-checked' },
      { name: 'files', source: 'not-checked' },
    ])
    api.listMcpSecrets.mockResolvedValue([])
  })

  it('opens without connecting: a server nobody checked says so', async () => {
    renderPanel()

    const list = await screen.findByRole('list', { name: 'MCP servers' })
    expect(within(list).getAllByText('Not checked yet')).toHaveLength(2)
    expect(api.getMcpServerStatuses).toHaveBeenCalledWith({ projectPath: PROJECT })
    expect(api.inspectMcpServer).not.toHaveBeenCalled()
  })

  it('connects only when asked: Check connection inspects that server and shows the result', async () => {
    let finishCheck: () => void = () => {}
    api.inspectMcpServer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = () => {
            // The Host remembers the check, so the next status read reports it.
            api.getMcpServerStatuses.mockResolvedValue(
              lastChecked([
                {
                  name: 'docs',
                  state: 'connected',
                  tools: [{ name: 'search', exposure: 'codemode', hasApp: false }],
                },
              ]),
            )
            resolve({ name: 'docs', state: 'connected', tools: [] })
          }
        }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Open docs' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Check connection' }))

    expect(await screen.findByText('Checking…')).toBeInTheDocument()
    expect(api.inspectMcpServer).toHaveBeenCalledTimes(1)
    expect(api.inspectMcpServer).toHaveBeenCalledWith({ projectPath: PROJECT, name: 'docs' })
    finishCheck()
    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Last checked just now.')).toBeInTheDocument()
    expect(screen.getByText('search')).toBeInTheDocument()
  })

  it('shows a Session’s warm connection as connected without checking it', async () => {
    api.getMcpServerStatuses.mockResolvedValue([
      {
        name: 'docs',
        source: 'live',
        inspection: { name: 'docs', state: 'connected', tools: [] },
      },
      { name: 'files', source: 'not-checked' },
    ])
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Open docs' }))

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('A session is connected to this server.')).toBeInTheDocument()
    await waitFor(() => expect(api.getMcpServerStatuses).toHaveBeenCalled())
    expect(api.inspectMcpServer).not.toHaveBeenCalled()
  })
})
