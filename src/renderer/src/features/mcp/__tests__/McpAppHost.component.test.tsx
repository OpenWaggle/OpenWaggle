import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const bridgeMock = vi.hoisted(() => vi.fn<(input: unknown) => void>())
const setComposerTextValueMock = vi.hoisted(() => vi.fn())

vi.mock('../mcp-app-bridge', () => ({ useMcpAppBridge: bridgeMock }))
vi.mock('../use-mcp-app-resource', () => ({
  useMcpAppResource: () => ({
    resource: {
      html: '<main>Weather</main>',
      csp: { connectDomains: [], resourceDomains: [] },
      requestedPermissions: [],
    },
    error: null,
  }),
}))
vi.mock('@/features/chat/lib', () => ({ setComposerTextValue: setComposerTextValueMock }))

import { McpAppHost } from '../McpAppHost'

function hasStagedContextCallback(
  value: unknown,
): value is { readonly onStagedContext: (context: unknown) => void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'onStagedContext' in value &&
    typeof value.onStagedContext === 'function'
  )
}

function stagedContextCallback(value: unknown) {
  return hasStagedContextCallback(value) ? value.onStagedContext : null
}

describe('McpAppHost', () => {
  it('shows staged context through the structured adapter before adding it to a draft', async () => {
    render(
      <McpAppHost
        descriptor={{
          serverInstanceId: 'server-1',
          serverLabel: 'weather',
          toolHandle: 'weather_handle',
          toolName: 'show_weather',
          toolTitle: 'Show weather',
          resourceUri: 'ui://weather/app',
          allowedNetworkDomains: [],
        }}
        projectPath="/project"
        sessionId="session-1"
      />,
    )

    fireEvent.load(screen.getByTitle('Show weather MCP App'))
    await waitFor(() =>
      expect(bridgeMock.mock.calls.some(([input]) => stagedContextCallback(input) !== null)).toBe(
        true,
      ),
    )
    const callback = bridgeMock.mock.calls
      .map(([input]) => stagedContextCallback(input))
      .find((candidate) => candidate !== null)
    if (!callback) throw new Error('Expected the ready MCP App bridge input.')

    act(() => callback({ forecast: 'sunny', temperature: 27 }))

    expect(screen.getByLabelText('Staged context from weather')).toHaveTextContent('"sunny"')
    fireEvent.click(screen.getByRole('button', { name: 'Add to editable draft' }))
    expect(setComposerTextValueMock).toHaveBeenCalledWith(
      'MCP App context from weather\n\n{\n  "forecast": "sunny",\n  "temperature": 27\n}',
    )
  })
})
