import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  inspectMcpServer: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  listMcpSecrets: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))
vi.mock('@/features/settings/hooks/useResourceProject', () => ({
  useResourceProject: () => ({
    projects: [PROJECT],
    projectPath: PROJECT,
    displayNames: {},
    setSelectedProject: vi.fn(),
    openFolder: vi.fn(),
    folderError: null,
    loadProjectsPage: vi.fn(),
  }),
}))

import { McpSection } from '../../McpSection'

describe('Settings > MCP', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpConfiguration.mockResolvedValue(mcpView([mcpServer('docs')]))
    api.getMcpServerStatuses.mockResolvedValue([{ name: 'docs', source: 'not-checked' }])
    api.listMcpSecrets.mockResolvedValue([])
  })

  it("reads the selected project's MCP files together with the global ones", async () => {
    renderWithQueryClient(<McpSection />)

    expect(await screen.findByRole('button', { name: 'Open docs' })).toBeInTheDocument()
    expect(api.getMcpConfiguration).toHaveBeenCalledWith({ projectPath: PROJECT })
    expect(screen.getByRole('heading', { name: 'MCP' })).toBeInTheDocument()
  })

  it('starts no server on open: it reads the known states and inspects nothing', async () => {
    renderWithQueryClient(<McpSection />)

    expect(await screen.findByText('Not checked yet')).toBeInTheDocument()
    expect(api.getMcpServerStatuses).toHaveBeenCalledWith({ projectPath: PROJECT })
    expect(api.inspectMcpServer).not.toHaveBeenCalled()
  })
})
