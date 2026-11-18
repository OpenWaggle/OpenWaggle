import type { McpServerToolView } from '@shared/types/mcp-configuration'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { McpServerList } from '../McpServerList'
import { mcpServer } from './mcp-section.test-fixtures'

const TOOL: McpServerToolView = { name: 'search', exposure: 'codemode', hasApp: false }

describe('the MCP server list', () => {
  it('names each row with what it shows: the server, its state, tools, exposure and file', () => {
    const onOpen = vi.fn()
    render(
      <McpServerList
        rows={[
          {
            server: mcpServer('github'),
            status: 'connected',
            inspection: { name: 'github', state: 'connected', tools: [TOOL, TOOL] },
          },
          {
            // A file-level direct runs, and shows, as codemode.
            server: mcpServer('sentry', {
              exposure: 'direct',
              source: { fileId: 'openwaggle-global', path: '/Users/me/.openwaggle/mcp.json' },
            }),
            status: 'needs-sign-in',
          },
        ]}
        onOpen={onOpen}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open github Connected 2 tools Codemode Pi, all projects ~/.pi/agent/mcp.json',
      }),
    )
    expect(
      screen.getByRole('button', {
        name: 'Open sentry Needs sign-in Codemode OpenWaggle, all projects ~/.openwaggle/mcp.json',
      }),
    ).toBeInTheDocument()
    expect(onOpen).toHaveBeenCalledWith('github')
  })
})
