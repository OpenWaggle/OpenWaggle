import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  listMcpSecrets: vi.fn(),
  setMcpSecret: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpServersPanel } from '../McpServersPanel'

const OPENWAGGLE_GLOBAL = {
  fileId: 'openwaggle-global',
  path: '/Users/me/.openwaggle/mcp.json',
} as const

describe('Settings > MCP for a server whose vault secret is missing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Imported with a credential the import could not copy: it reads a secret nobody added yet.
    api.getMcpConfiguration.mockResolvedValue(
      mcpView([
        mcpServer('api', { source: OPENWAGGLE_GLOBAL, vaultSecrets: ['API_TOKEN'] }),
        mcpServer('plain'),
      ]),
    )
    api.getMcpServerStatuses.mockResolvedValue([])
    api.listMcpSecrets.mockResolvedValue([])
    api.setMcpSecret.mockResolvedValue([{ name: 'API_TOKEN', createdAt: 1, updatedAt: 1 }])
  })

  it('says so in the list and the detail, and leads to Secrets with its name filled in', async () => {
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)
    await screen.findByRole('list', { name: 'MCP servers' })
    // Queried each time: going back from the detail renders the list again.
    const row = (name: string) =>
      within(screen.getByRole('list', { name: 'MCP servers' })).getByRole('button', {
        name: new RegExp(`Open ${name}`),
      })

    await waitFor(() => expect(row('api')).toHaveTextContent('Needs secret API_TOKEN'))
    expect(row('plain')).not.toHaveTextContent('Needs secret')

    fireEvent.click(row('api'))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Needs secret API_TOKEN. Until it is added, this server is left out of every Run.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add API_TOKEN in Secrets' }))

    const form = await screen.findByRole('form', { name: 'Add secret' })
    expect(within(form).getByLabelText('Secret name')).toHaveValue('API_TOKEN')
    expect(within(form).getByLabelText('Secret value')).toHaveFocus()
    fireEvent.change(within(form).getByLabelText('Secret value'), { target: { value: 'v' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.setMcpSecret).toHaveBeenCalledWith({ name: 'API_TOKEN', value: 'v' }),
    )
    await waitFor(() => expect(row('api')).not.toHaveTextContent('Needs secret'))
  })
})
