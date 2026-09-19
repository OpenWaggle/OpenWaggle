// @vitest-environment jsdom

import type { McpAppDescriptor } from '@shared/types/mcp'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readMcpResource } = vi.hoisted(() => ({ readMcpResource: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: { readMcpResource } }))

import { useMcpAppResource } from '../use-mcp-app-resource'

const descriptor: McpAppDescriptor = {
  serverInstanceId: 'server-1',
  serverLabel: 'Weather',
  serverConfigHash: 'config-1',
  toolHandle: 'tool-handle',
  toolName: 'show_weather',
  toolTitle: 'Show weather',
  resourceUri: 'ui://weather/app',
  allowedNetworkDomains: [],
}

describe('useMcpAppResource', () => {
  beforeEach(() => readMcpResource.mockReset())

  it('clears a prior request error when a changed descriptor loads successfully', async () => {
    readMcpResource
      .mockRejectedValueOnce(new Error('old server unavailable'))
      .mockResolvedValueOnce({
        attribution: { serverInstanceId: 'server-1', serverLabel: 'Weather' },
        contents: [{ uri: descriptor.resourceUri, text: '<main>Updated app</main>' }],
      })
    const hook = renderHook(
      ({ currentDescriptor }) => useMcpAppResource(currentDescriptor, '/tmp/project', 'session-1'),
      { initialProps: { currentDescriptor: descriptor } },
    )

    await waitFor(() => expect(hook.result.current.error).toBe('old server unavailable'))
    hook.rerender({
      currentDescriptor: { ...descriptor, serverConfigHash: 'config-2' },
    })

    expect(hook.result.current).toEqual({ resource: null, error: null })
    await waitFor(() => expect(hook.result.current.resource?.html).toContain('Updated app'))
    expect(hook.result.current.error).toBeNull()
    expect(readMcpResource).toHaveBeenLastCalledWith(
      expect.objectContaining({ serverConfigHash: 'config-2' }),
    )
  })
})
