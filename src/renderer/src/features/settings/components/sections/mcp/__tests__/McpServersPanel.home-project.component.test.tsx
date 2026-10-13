import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { FILES, mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  listMcpSecrets: vi.fn(),
  addMcpServer: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpServersPanel } from '../McpServersPanel'

/**
 * A project that is the home folder: its `.openwaggle/mcp.json` is OpenWaggle's global file, so
 * the view has no project OpenWaggle file and the Host refuses project switches.
 */
const HOME_PROJECT_FILES = FILES.filter((file) => file.fileId !== 'project-openwaggle')

describe('Settings > MCP for a project that is the home folder', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpConfiguration.mockResolvedValue({
      ...mcpView([mcpServer('docs')]),
      files: HOME_PROJECT_FILES,
    })
    api.getMcpServerStatuses.mockResolvedValue([])
    api.listMcpSecrets.mockResolvedValue([])
    api.addMcpServer.mockResolvedValue(mcpView([mcpServer('docs'), mcpServer('files')]))
  })

  it('offers no switch for this project alone', async () => {
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Open docs / }))

    expect(await screen.findByRole('switch', { name: 'Turn off docs' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off in this project' })).toBeNull()
  })

  it('saves a server for this project to a file it has', async () => {
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)
    await screen.findByRole('button', { name: /^Open docs / })
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
    const form = screen.getByRole('form', { name: 'Add server' })

    fireEvent.change(within(form).getByLabelText('Use in'), { target: { value: 'project' } })

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'files' } })
    fireEvent.change(within(form).getByLabelText('Command'), { target: { value: 'files-mcp' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(api.addMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'project', destination: 'project-mcp-json' }),
      ),
    )
  })
})
