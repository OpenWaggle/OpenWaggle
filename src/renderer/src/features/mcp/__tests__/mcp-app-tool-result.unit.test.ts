import { describe, expect, it } from 'vitest'
import { getMcpAppLaunch } from '../mcp-app-tool-result'

describe('MCP App transcript launch projection', () => {
  it('extracts only attributed gateway App payloads', () => {
    const launch = getMcpAppLaunch(
      {
        content: [{ type: 'text', text: 'done' }],
        details: {
          kind: 'gateway',
          result: {
            app: {
              descriptor: {
                serverInstanceId: 'server-1',
                serverLabel: 'maps',
                toolHandle: 'mcp_handle',
                toolName: 'show_map',
                toolTitle: 'Show map',
                resourceUri: 'ui://maps/app',
                allowedNetworkDomains: [],
              },
              toolResult: {
                content: [{ type: 'text', text: 'done' }],
                structuredContent: { latitude: 1 },
                isError: false,
              },
            },
          },
        },
      },
      { operation: 'call', arguments: { city: 'Madrid' } },
    )

    expect(launch).toEqual({
      descriptor: expect.objectContaining({ resourceUri: 'ui://maps/app' }),
      initialArguments: { city: 'Madrid' },
      initialResult: expect.objectContaining({
        structuredContent: { latitude: 1 },
        attribution: {
          serverInstanceId: 'server-1',
          serverLabel: 'maps',
          toolName: 'show_map',
        },
      }),
    })
  })

  it('does not render arbitrary tool results as Apps', () => {
    expect(getMcpAppLaunch({ content: 'not an App' }, {})).toBeNull()
  })
})
