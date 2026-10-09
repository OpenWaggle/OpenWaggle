import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  listMcpSecrets: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  removeMcpServer: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpServersPanel } from '../McpServersPanel'

const PROJECT_OPENWAGGLE = {
  fileId: 'project-openwaggle',
  path: `${PROJECT}/.openwaggle/mcp.json`,
} as const

describe('Settings > MCP switches and overrides', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpServerStatuses.mockResolvedValue([])
    api.listMcpSecrets.mockResolvedValue([])
  })

  it('names the switch after its state', async () => {
    api.getMcpConfiguration.mockResolvedValue(mcpView([mcpServer('fs', { enabled: false })]))
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)

    fireEvent.click(await screen.findByRole('button', { name: /Open fs/ }))

    const toggle = await screen.findByRole('switch', { name: 'Turn on fs' })
    expect(toggle).not.toBeChecked()
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0)
    expect(screen.queryByText('On')).not.toBeInTheDocument()
  })

  it('shows no override once the project switch is back to what the files below give', async () => {
    api.getMcpConfiguration.mockResolvedValue(
      mcpView([
        mcpServer('fs', { enabled: false, offByOverride: true, override: PROJECT_OPENWAGGLE }),
      ]),
    )
    // The Host takes the switch out of the project file, so the server is plain again.
    api.setMcpServerEnabled.mockResolvedValue(mcpView([mcpServer('fs')]))
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)
    fireEvent.click(await screen.findByRole('button', { name: /Open fs/ }))

    fireEvent.click(await screen.findByRole('switch', { name: 'Turn on fs' }))

    await waitFor(() =>
      expect(api.setMcpServerEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: PROJECT, name: 'fs', enabled: true }),
      ),
    )
    await waitFor(() => expect(screen.queryByText('Overridden in')).not.toBeInTheDocument())
    expect(screen.getByRole('switch', { name: 'Turn off fs' })).toBeChecked()
  })

  it('removes an orphaned override from the warning that reports it', async () => {
    const warning = `${PROJECT}/.openwaggle/mcp.json: server "gone" only changes a server no file defines any more; it is ignored`
    api.getMcpConfiguration.mockResolvedValue({
      ...mcpView([mcpServer('plain')]),
      warnings: [warning],
      orphanedOverrides: [{ name: 'gone', ...PROJECT_OPENWAGGLE }],
    })
    api.removeMcpServer.mockResolvedValue(mcpView([mcpServer('plain')]))
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)

    const ignored = await screen.findByLabelText('Ignored MCP configuration')
    expect(ignored).toHaveTextContent('server "gone" only changes a server no file defines')
    fireEvent.click(screen.getByRole('button', { name: 'Remove override for gone' }))

    await waitFor(() =>
      expect(api.removeMcpServer).toHaveBeenCalledWith({
        projectPath: PROJECT,
        name: 'gone',
        // Only that entry: never the server's definition in another file.
        orphanedOverride: { fileId: 'project-openwaggle' },
      }),
    )
    await waitFor(() =>
      expect(screen.queryByLabelText('Ignored MCP configuration')).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /Remove override/ })).not.toBeInTheDocument()
  })
})
