import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  listMcpSecrets: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpServersPanel } from '../McpServersPanel'

const OPENWAGGLE_GLOBAL = {
  fileId: 'openwaggle-global',
  path: '/Users/me/.openwaggle/mcp.json',
} as const
const PROJECT_PI = { fileId: 'project-pi', path: `${PROJECT}/.pi/mcp.json` } as const

describe('Settings > MCP list rows', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpServerStatuses.mockResolvedValue([])
    api.listMcpSecrets.mockResolvedValue([])
  })

  it('mark a server another file overrides, and a Pi server OpenWaggle keeps off', async () => {
    api.getMcpConfiguration.mockResolvedValue(
      mcpView([
        mcpServer('plain'),
        mcpServer('exposed', { override: PROJECT_PI }),
        // A Pi server that never ran in OpenWaggle: the migration kept it off in OpenWaggle's file.
        mcpServer('piserver', {
          enabled: false,
          offByOverride: true,
          override: OPENWAGGLE_GLOBAL,
        }),
        // Pi's own file turned it off; OpenWaggle's file only changes its exposure.
        mcpServer('pioff', { enabled: false, override: OPENWAGGLE_GLOBAL }),
      ]),
    )
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)

    const list = await screen.findByRole('list', { name: 'MCP servers' })
    const row = (name: string) =>
      within(list).getByRole('button', { name: new RegExp(`Open ${name}`) })

    expect(row('plain')).not.toHaveTextContent(/Overridden|Off in OpenWaggle/)
    expect(row('exposed')).toHaveTextContent(/Overridden in .*\.pi\/mcp\.json/)
    expect(row('piserver')).toHaveTextContent('Off in OpenWaggle')
    expect(row('pioff')).not.toHaveTextContent('Off in OpenWaggle')
    expect(row('pioff')).toHaveTextContent(/Overridden in .*\.openwaggle\/mcp\.json/)
    expect(within(row('piserver')).getByText('Off in OpenWaggle')).toHaveAttribute(
      'title',
      expect.stringContaining('The file that defines it still has it on'),
    )

    fireEvent.click(row('piserver'))
    expect(
      await screen.findByText(/Off in OpenWaggle: the file that defines it still has it on/),
    ).toBeVisible()
  })

  it('shows ignored entries as a note, not as configuration errors', async () => {
    api.getMcpConfiguration.mockResolvedValue({
      ...mcpView([mcpServer('plain')]),
      warnings: ['/p/.openwaggle/mcp.json: server "gone" only changes a server no file defines'],
    })
    renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)

    expect(await screen.findByLabelText('Ignored MCP configuration')).toHaveTextContent(
      'server "gone" only changes a server no file defines',
    )
    expect(screen.queryByLabelText('Configuration errors')).not.toBeInTheDocument()
  })
})
