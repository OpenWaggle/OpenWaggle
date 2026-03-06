import { McpServerId } from '@shared/types/brand'
import type { McpServerConfig, McpServerStatus } from '@shared/types/mcp'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { useMcp } from './useMcp'

const {
  addMcpServerMock,
  listMcpServersMock,
  onMcpStatusChangedMock,
  removeMcpServerMock,
  toggleMcpServerMock,
} = vi.hoisted(() => ({
  addMcpServerMock: vi.fn(),
  listMcpServersMock: vi.fn(),
  onMcpStatusChangedMock: vi.fn(),
  removeMcpServerMock: vi.fn(),
  toggleMcpServerMock: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    listMcpServers: listMcpServersMock,
    addMcpServer: addMcpServerMock,
    removeMcpServer: removeMcpServerMock,
    toggleMcpServer: toggleMcpServerMock,
    onMcpStatusChanged: onMcpStatusChangedMock,
  },
}))

function createServer(overrides?: Partial<McpServerStatus>): McpServerStatus {
  return {
    id: McpServerId('mcp-1'),
    name: 'playwright',
    status: 'connected',
    toolCount: 1,
    tools: [],
    ...overrides,
  }
}

describe('useMcp', () => {
  beforeEach(() => {
    addMcpServerMock.mockReset()
    listMcpServersMock.mockReset()
    onMcpStatusChangedMock.mockReset()
    removeMcpServerMock.mockReset()
    toggleMcpServerMock.mockReset()
    onMcpStatusChangedMock.mockReturnValue(() => {})
  })

  it('loads MCP servers successfully', async () => {
    const server = createServer()
    listMcpServersMock.mockResolvedValueOnce([server])

    const { result } = renderHookWithQueryClient(() => useMcp())

    await waitFor(() => {
      expect(result.current.servers).toEqual([server])
    })
    expect(result.current.loadError).toBeNull()
    expect(result.current.actionError).toBeNull()
  })

  it('surfaces load failures through the hook error state', async () => {
    listMcpServersMock.mockRejectedValueOnce(new Error('MCP load failed'))

    const { result } = renderHookWithQueryClient(() => useMcp())

    await waitFor(() => {
      expect(result.current.loadError).toBe('MCP load failed')
      expect(result.current.actionError).toBeNull()
    })
  })

  it('invalidates the servers query and closes the add form after a successful add', async () => {
    const initialServer = createServer()
    const addedServer = createServer({
      id: McpServerId('mcp-2'),
      name: 'chrome-devtools',
      toolCount: 2,
    })
    const config: Omit<McpServerConfig, 'id'> = {
      name: 'chrome-devtools',
      transport: 'stdio',
      enabled: true,
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
    }

    listMcpServersMock
      .mockResolvedValueOnce([initialServer])
      .mockResolvedValueOnce([initialServer, addedServer])
    addMcpServerMock.mockResolvedValueOnce({ ok: true, id: addedServer.id })

    const { result } = renderHookWithQueryClient(() => useMcp())

    await waitFor(() => {
      expect(result.current.servers).toEqual([initialServer])
    })

    act(() => {
      result.current.setAddFormOpen(true)
    })

    await act(async () => {
      expect(await result.current.addServer(config)).toEqual({ ok: true })
    })

    await waitFor(() => {
      expect(listMcpServersMock).toHaveBeenCalledTimes(2)
      expect(result.current.servers).toEqual([initialServer, addedServer])
      expect(result.current.isAddFormOpen).toBe(false)
    })
  })

  it('invalidates the servers query after removing a server', async () => {
    const server = createServer()
    listMcpServersMock.mockResolvedValueOnce([server]).mockResolvedValueOnce([])
    removeMcpServerMock.mockResolvedValueOnce({ ok: true })

    const { result } = renderHookWithQueryClient(() => useMcp())

    await waitFor(() => {
      expect(result.current.servers).toEqual([server])
    })

    await act(async () => {
      await result.current.removeServer(server.id)
    })

    await waitFor(() => {
      expect(listMcpServersMock).toHaveBeenCalledTimes(2)
      expect(result.current.servers).toEqual([])
    })
  })

  it('invalidates the servers query after toggling a server', async () => {
    const disconnectedServer = createServer({ status: 'disconnected' })
    const connectedServer = createServer({ status: 'connected' })
    listMcpServersMock
      .mockResolvedValueOnce([disconnectedServer])
      .mockResolvedValueOnce([connectedServer])
    toggleMcpServerMock.mockResolvedValueOnce({ ok: true })

    const { result } = renderHookWithQueryClient(() => useMcp())

    await waitFor(() => {
      expect(result.current.servers).toEqual([disconnectedServer])
    })

    await act(async () => {
      await result.current.toggleServer(disconnectedServer.id, true)
    })

    await waitFor(() => {
      expect(listMcpServersMock).toHaveBeenCalledTimes(2)
      expect(result.current.servers).toEqual([connectedServer])
    })
  })

  it('patches the cached MCP server status from subscription events', async () => {
    const disconnectedServer = createServer({ status: 'disconnected' })
    const connectedServer = createServer({ status: 'connected' })
    let listener: ((status: McpServerStatus) => void) | null = null

    listMcpServersMock.mockResolvedValueOnce([disconnectedServer])
    onMcpStatusChangedMock.mockImplementation((callback: (status: McpServerStatus) => void) => {
      listener = callback
      return () => {}
    })

    const { result } = renderHookWithQueryClient(() => useMcp())

    await waitFor(() => {
      expect(result.current.servers).toEqual([disconnectedServer])
    })

    act(() => {
      listener?.(connectedServer)
    })

    await waitFor(() => {
      expect(result.current.servers).toEqual([connectedServer])
      expect(listMcpServersMock).toHaveBeenCalledTimes(1)
    })
  })

  it('preserves loaded servers and surfaces an action error when toggling fails', async () => {
    const server = createServer({ status: 'disconnected' })
    listMcpServersMock.mockResolvedValueOnce([server])
    toggleMcpServerMock.mockResolvedValueOnce({ ok: false, error: 'Toggle exploded' })

    const { result } = renderHookWithQueryClient(() => useMcp())

    await waitFor(() => {
      expect(result.current.servers).toEqual([server])
    })

    await act(async () => {
      await result.current.toggleServer(server.id, true)
    })

    expect(result.current.servers).toEqual([server])
    expect(result.current.loadError).toBeNull()
    expect(result.current.actionError).toBe('Toggle exploded')
    expect(listMcpServersMock).toHaveBeenCalledTimes(1)
  })
})
