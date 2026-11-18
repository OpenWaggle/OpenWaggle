import { describe, expect, it } from 'vitest'
import { getMcpAppLaunch } from '../mcp-app-tool-result'

describe('MCP App transcript launch projection', () => {
  it('opens the App that the MCP layer attached to a Pi MCP tool result', () => {
    const launch = getMcpAppLaunch(
      {
        content: [{ type: 'text', text: 'done' }],
        details: {
          server: 'maps',
          tool: 'show_map',
          mcpApp: {
            descriptor: {
              serverInstanceId: 'server-1',
              serverLabel: 'maps',
              serverConfigHash: 'config-1',
              toolHandle: 'mcp__maps__show_map',
              toolName: 'show_map',
              toolTitle: 'Show map',
              resourceUri: 'ui://maps/app',
            },
            toolResult: {
              content: [{ type: 'text', text: 'done' }],
              structuredContent: { latitude: 1 },
              isError: false,
            },
          },
        },
      },
      { city: 'Madrid' },
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
