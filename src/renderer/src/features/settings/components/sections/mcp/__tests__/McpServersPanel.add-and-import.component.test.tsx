import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  inspectMcpServer: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  addMcpServer: vi.fn(),
  installMcpCatalogServer: vi.fn(),
  previewMcpImports: vi.fn(),
  applyMcpImports: vi.fn(),
  listMcpSecrets: vi.fn(),
  setMcpSecret: vi.fn(),
  removeMcpSecret: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpServersPanel } from '../McpServersPanel'

function renderPanel() {
  return renderWithQueryClient(<McpServersPanel projectPath={PROJECT} />)
}

async function openAddForm() {
  renderPanel()
  await screen.findByText(/No MCP servers yet/)
  fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
  return screen.getByRole('form', { name: 'Add server' })
}

describe('Settings > MCP: adding servers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpConfiguration.mockResolvedValue(mcpView([]))
    api.getMcpServerStatuses.mockResolvedValue([])
    api.listMcpSecrets.mockResolvedValue([{ name: 'docs-token', createdAt: 1, updatedAt: 1 }])
    api.addMcpServer.mockResolvedValue(mcpView([mcpServer('files')]))
  })

  it("saves a new command server to OpenWaggle's file for all projects by default", async () => {
    const form = await openAddForm()

    expect(within(form).getByLabelText('Save to')).toHaveValue('openwaggle-global')
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'files' } })
    fireEvent.change(within(form).getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.change(within(form).getByLabelText('Arguments, one per line'), {
      target: { value: '-y\n@modelcontextprotocol/server-filesystem\n.' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(api.addMcpServer).toHaveBeenCalledWith({
        projectPath: PROJECT,
        name: 'files',
        scope: 'global',
        destination: 'openwaggle-global',
        entry: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
      }),
    )
  })

  it("defaults to the project's OpenWaggle file for this project and offers Pi's files", async () => {
    const form = await openAddForm()

    fireEvent.change(within(form).getByLabelText('Use in'), { target: { value: 'project' } })

    const destination = within(form).getByLabelText('Save to')
    expect(destination).toHaveValue('project-openwaggle')
    expect(
      within(destination)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['OpenWaggle, this project (recommended)', 'Project .mcp.json', 'Pi, this project'])
  })

  it("allows vault secrets only while saving to OpenWaggle's files", async () => {
    const form = await openAddForm()
    fireEvent.change(within(form).getByLabelText('Connects with'), { target: { value: 'url' } })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'docs' } })
    fireEvent.change(within(form).getByLabelText('URL'), {
      target: { value: 'https://docs.example/mcp' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Add header' }))
    fireEvent.change(within(form).getByLabelText('Header 1 name'), {
      target: { value: 'Authorization' },
    })
    fireEvent.click(within(form).getByLabelText('Secret'))
    fireEvent.change(within(form).getByLabelText('Header 1 secret'), {
      target: { value: 'docs-token' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(api.addMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: {
            url: 'https://docs.example/mcp',
            headers: { Authorization: { secret: 'docs-token' } },
          },
        }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }))
    const second = screen.getByRole('form', { name: 'Add server' })
    fireEvent.change(within(second).getByLabelText('Save to'), { target: { value: 'pi-global' } })
    fireEvent.click(within(second).getByRole('button', { name: 'Add variable' }))
    expect(within(second).getByLabelText('Secret')).toBeDisabled()
  })

  it('explains what is wrong before saving an incomplete server', async () => {
    const form = await openAddForm()
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'bad name' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add server' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Name the server with letters, digits, - or _.',
    )
    expect(api.addMcpServer).not.toHaveBeenCalled()
  })

  it('installs a recommended server with one click', async () => {
    api.installMcpCatalogServer.mockResolvedValue(mcpView([mcpServer('playwright')]))
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Install Playwright MCP' }))

    await waitFor(() =>
      expect(api.installMcpCatalogServer).toHaveBeenCalledWith({
        projectPath: PROJECT,
        catalogName: 'playwright',
        scope: 'global',
      }),
    )
    expect(await screen.findByText('Installed')).toBeInTheDocument()
  })
})

describe('Settings > MCP: importing from other apps', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpConfiguration.mockResolvedValue(mcpView([]))
    api.listMcpSecrets.mockResolvedValue([])
    api.previewMcpImports.mockResolvedValue({
      candidates: [
        {
          source: 'cursor',
          sourcePath: '/Users/me/.cursor/mcp.json',
          suggestedTarget: 'global',
          name: 'linear',
          targetName: 'linear',
          target: 'https://mcp.linear.app/mcp',
          fingerprint: 'fp-linear',
          warnings: [],
          status: 'new',
        },
        {
          source: 'codex',
          sourcePath: '/Users/me/.codex/config.toml',
          suggestedTarget: 'global',
          name: 'files',
          targetName: 'files',
          target: 'npx files-mcp',
          fingerprint: 'fp-files',
          warnings: ['env FILES_TOKEN was dropped'],
          status: 'imported',
        },
      ],
      unavailableSources: [],
      errors: [],
    })
  })

  it('previews, lets the user choose, and imports into the chosen scope', async () => {
    api.applyMcpImports.mockResolvedValue({
      imported: [
        { source: 'cursor', sourceName: 'linear', targetName: 'linear', fingerprint: 'fp-linear' },
      ],
      skipped: [],
      view: mcpView([mcpServer('linear')]),
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }))

    const linear = await screen.findByRole('checkbox', { name: 'Import linear from Cursor' })
    expect(screen.getByRole('checkbox', { name: 'Import files from Codex' })).toBeDisabled()
    expect(screen.getByText('env FILES_TOKEN was dropped')).toBeInTheDocument()
    fireEvent.click(linear)
    fireEvent.change(screen.getByRole('combobox', { name: 'Import into' }), {
      target: { value: 'project' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 selected' }))

    await waitFor(() =>
      expect(api.applyMcpImports).toHaveBeenCalledWith({
        projectPath: PROJECT,
        fingerprints: ['fp-linear'],
        target: 'project',
        conflictPolicy: 'skip',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 1.')
    expect(await screen.findByRole('button', { name: /^Open linear / })).toBeInTheDocument()
  })
})
