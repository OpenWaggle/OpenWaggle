import { McpServerId } from '@shared/types/brand'
import type { McpServerStatus } from '@shared/types/mcp'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { McpListView } from './McpListView'

function createServer(overrides?: Partial<McpServerStatus>): McpServerStatus {
  return {
    id: McpServerId('mcp-1'),
    name: 'playwright',
    status: 'connected',
    toolCount: 2,
    tools: [],
    ...overrides,
  }
}

describe('McpListView', () => {
  it('keeps the current server list visible when an action error occurs', () => {
    render(
      <McpListView
        servers={[createServer()]}
        isLoading={false}
        loadError={null}
        actionError="Toggle exploded"
        onAddClick={vi.fn()}
        onInstall={vi.fn(async () => ({ ok: true }))}
        onToggle={vi.fn(async () => undefined)}
        onRemove={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Toggle exploded')
    expect(screen.getByText('playwright')).toBeInTheDocument()
    expect(screen.getByText('2 tools')).toBeInTheDocument()
  })
})
