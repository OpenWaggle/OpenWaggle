import type { McpRegistryServerView } from '@shared/types/mcp-registry'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { mcpServer, mcpView, PROJECT } from './mcp-section.test-fixtures'

const api = vi.hoisted(() => ({
  getMcpConfiguration: vi.fn(),
  searchMcpRegistry: vi.fn(),
  installMcpRegistryServer: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { McpRegistryPanel } from '../McpRegistryPanel'

const WEATHER: McpRegistryServerView = {
  name: 'io.github.example/weather',
  version: '2.0.0',
  title: 'Weather',
  description: 'Weather forecasts.',
  suggestedName: 'weather',
  installOptions: [
    { method: 'remote', target: 'https://weather.example/mcp' },
    { method: 'npm', target: '@example/weather@1.2.3' },
  ],
}

const FILES: McpRegistryServerView = {
  name: 'io.github.example/files',
  version: '1.0.0',
  suggestedName: 'files',
  installOptions: [{ method: 'npm', target: '@example/files@1.0.0' }],
}

async function searchFor(query: string) {
  renderWithQueryClient(<McpRegistryPanel projectPath={PROJECT} />)
  const form = screen.getByRole('form', { name: 'Search the MCP Registry' })
  fireEvent.change(within(form).getByRole('textbox', { name: 'Search the MCP Registry' }), {
    target: { value: query },
  })
  fireEvent.click(within(form).getByRole('button', { name: 'Search' }))
  return screen.findByRole('list', { name: 'Registry servers' })
}

describe('Settings > MCP: MCP Registry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getMcpConfiguration.mockResolvedValue(mcpView([mcpServer('files')]))
    api.searchMcpRegistry.mockResolvedValue({ servers: [WEATHER, FILES] })
  })

  it('searches the Registry and marks servers that are already configured', async () => {
    const list = await searchFor('  weather ')

    expect(api.searchMcpRegistry).toHaveBeenCalledWith({ query: 'weather' })
    expect(within(list).getByText('Weather forecasts.')).toBeInTheDocument()
    expect(within(list).getByText('https://weather.example/mcp')).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Install Weather' })).toBeEnabled()
    expect(within(list).getByText('Installed')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'Install files' })).not.toBeInTheDocument()
  })

  it('installs the chosen way to run it for this project and names the secrets it needs', async () => {
    api.installMcpRegistryServer.mockResolvedValue({
      name: 'weather',
      filePath: `${PROJECT}/.openwaggle/mcp.json`,
      secrets: ['WEATHER_KEY', 'WEATHER_TOKEN'],
      existingSecrets: ['WEATHER_TOKEN'],
      view: mcpView([mcpServer('files'), mcpServer('weather')]),
    })
    const list = await searchFor('weather')

    fireEvent.change(screen.getByLabelText('Install Registry servers for'), {
      target: { value: 'project' },
    })
    fireEvent.change(within(list).getByLabelText('How to run Weather'), {
      target: { value: 'npm' },
    })
    expect(within(list).getByText('@example/weather@1.2.3')).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: 'Install Weather' }))

    await waitFor(() =>
      expect(api.installMcpRegistryServer).toHaveBeenCalledWith({
        projectPath: PROJECT,
        registryName: 'io.github.example/weather',
        version: '2.0.0',
        method: 'npm',
        scope: 'project',
      }),
    )
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(`Installed "weather" in ${PROJECT}/.openwaggle/mcp.json.`)
    expect(status).toHaveTextContent('It reads the secret WEATHER_KEY.')
    expect(status).toHaveTextContent(
      'It uses the secret WEATHER_TOKEN, which already exists under Secrets; replace it there if it holds another value.',
    )
    expect(await within(list).findAllByText('Installed')).toHaveLength(2)
  })

  it('shows why an install failed', async () => {
    api.installMcpRegistryServer.mockRejectedValue(
      new Error(
        'MCPB artifact SHA-256 did not match the Registry metadata; nothing was installed.',
      ),
    )
    const list = await searchFor('weather')

    fireEvent.click(within(list).getByRole('button', { name: 'Install Weather' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('nothing was installed')
  })

  it('says when nothing matches', async () => {
    api.searchMcpRegistry.mockResolvedValue({ servers: [] })
    renderWithQueryClient(<McpRegistryPanel projectPath={null} />)

    expect(screen.getByRole('option', { name: 'This project' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the MCP Registry' }), {
      target: { value: 'nothing' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('No Registry servers match "nothing".')).toBeInTheDocument()
  })
})
