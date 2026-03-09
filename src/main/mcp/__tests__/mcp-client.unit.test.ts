import { McpServerId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const clientConnectMock = vi.fn()
  const clientListToolsMock = vi.fn()
  const clientCallToolMock = vi.fn()
  const clientCloseMock = vi.fn()
  const clientNotificationHandlerMock = vi.fn()
  const getSafeChildEnvEntriesMock = vi.fn()
  const createLoggerMock = vi.fn()
  const loggerMock = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const stdioTransportOptions: Array<{
    command: string
    args: readonly string[]
    env?: Record<string, string>
  }> = []

  class MockClient {
    setNotificationHandler = clientNotificationHandlerMock
    connect = clientConnectMock
    listTools = clientListToolsMock
    callTool = clientCallToolMock
    close = clientCloseMock
  }

  class MockStdioClientTransport {
    onclose?: () => void
    onerror?: (error: Error) => void

    constructor(options: {
      command: string
      args: readonly string[]
      env?: Record<string, string>
    }) {
      stdioTransportOptions.push(options)
    }
  }

  class MockStreamableHTTPClientTransport {}

  class MockSSEClientTransport {}

  return {
    clientConnectMock,
    clientListToolsMock,
    clientCallToolMock,
    clientCloseMock,
    clientNotificationHandlerMock,
    getSafeChildEnvEntriesMock,
    createLoggerMock,
    loggerMock,
    stdioTransportOptions,
    MockClient,
    MockStdioClientTransport,
    MockStreamableHTTPClientTransport,
    MockSSEClientTransport,
  }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mocks.MockClient,
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mocks.MockStdioClientTransport,
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mocks.MockStreamableHTTPClientTransport,
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mocks.MockSSEClientTransport,
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ToolListChangedNotificationSchema: { method: 'notifications/tools/list_changed' },
}))

vi.mock('../../env', () => ({
  getSafeChildEnvEntries: mocks.getSafeChildEnvEntriesMock,
}))

vi.mock('../../logger', () => ({
  createLogger: mocks.createLoggerMock.mockImplementation(() => mocks.loggerMock),
}))

import { McpClient } from '../mcp-client'

describe('McpClient', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.clientConnectMock.mockReset()
    mocks.clientListToolsMock.mockReset()
    mocks.clientCallToolMock.mockReset()
    mocks.clientCloseMock.mockReset()
    mocks.clientNotificationHandlerMock.mockReset()
    mocks.getSafeChildEnvEntriesMock.mockReset()
    mocks.createLoggerMock.mockReset()
    mocks.loggerMock.debug.mockReset()
    mocks.loggerMock.info.mockReset()
    mocks.loggerMock.warn.mockReset()
    mocks.loggerMock.error.mockReset()
    mocks.stdioTransportOptions.length = 0

    mocks.getSafeChildEnvEntriesMock.mockReturnValue({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
    })
    mocks.clientConnectMock.mockResolvedValue(undefined)
    mocks.clientListToolsMock.mockResolvedValue({
      tools: [
        {
          name: 'list-files',
          description: 'List project files',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    })
    mocks.clientCloseMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects a stdio server with a safe base env, merges overrides, and hydrates tool metadata', async () => {
    const client = new McpClient(
      {
        id: McpServerId('server-1'),
        name: 'Local Files',
        transport: 'stdio',
        enabled: true,
        command: 'node',
        args: ['server.js'],
        env: { MCP_TOKEN: 'secret' },
      },
      {
        onStatusChange: vi.fn(),
        onToolsChanged: vi.fn(),
      },
    )

    await client.connect()

    expect(client.status).toBe('connected')
    expect(mocks.stdioTransportOptions).toEqual([
      {
        command: 'node',
        args: ['server.js'],
        env: {
          PATH: '/usr/bin',
          HOME: '/tmp/home',
          MCP_TOKEN: 'secret',
        },
      },
    ])
    expect(client.toolList).toEqual([
      {
        serverName: 'Local Files',
        name: 'list-files',
        namespacedName: 'local_files__list-files',
        description: 'List project files',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ])
  })

  it('does not inherit unrelated parent-process secrets into stdio env', async () => {
    mocks.getSafeChildEnvEntriesMock.mockReturnValue({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      SHELL: '/bin/zsh',
    })

    const client = new McpClient(
      {
        id: McpServerId('server-2'),
        name: 'Local Files',
        transport: 'stdio',
        enabled: true,
        command: 'node',
        env: { MCP_TOKEN: 'secret' },
      },
      {
        onStatusChange: vi.fn(),
        onToolsChanged: vi.fn(),
      },
    )

    await client.connect()

    expect(mocks.stdioTransportOptions.at(-1)?.env).toEqual({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      SHELL: '/bin/zsh',
      MCP_TOKEN: 'secret',
    })
    expect(mocks.stdioTransportOptions.at(-1)?.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(mocks.stdioTransportOptions.at(-1)?.env).not.toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('returns concatenated tool text output and throws server-side tool errors', async () => {
    const client = new McpClient(
      {
        id: McpServerId('server-1'),
        name: 'Local Files',
        transport: 'stdio',
        enabled: true,
        command: 'node',
      },
      {
        onStatusChange: vi.fn(),
        onToolsChanged: vi.fn(),
      },
    )

    await client.connect()

    mocks.clientCallToolMock.mockResolvedValueOnce({
      isError: false,
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ],
    })

    await expect(client.callTool('list-files', { path: '.' })).resolves.toBe('line one\nline two')

    mocks.clientCallToolMock.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'permission denied' }],
    })

    await expect(client.callTool('list-files', { path: '.' })).rejects.toThrow(
      'Tool "list-files" failed: permission denied',
    )
  })

  it('surfaces connection failures as error status and cleans up the client', async () => {
    mocks.clientConnectMock.mockRejectedValueOnce(new Error('connection refused'))

    const client = new McpClient(
      {
        id: McpServerId('server-1'),
        name: 'Local Files',
        transport: 'stdio',
        enabled: true,
        command: 'node',
      },
      {
        onStatusChange: vi.fn(),
        onToolsChanged: vi.fn(),
      },
    )

    await client.connect()

    expect(client.status).toBe('error')
    expect(client.error).toBe('connection refused')
    expect(mocks.clientCloseMock).toHaveBeenCalledTimes(1)
  })
})
