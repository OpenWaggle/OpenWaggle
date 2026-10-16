import { renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registerMock, unregisterMock } = vi.hoisted(() => ({
  registerMock: vi.fn(),
  unregisterMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { registerMcpAppFrame: registerMock, unregisterMcpAppFrame: unregisterMock },
}))

const { useMcpAppFrameRegistration } = await import('../use-mcp-app-frame-registration')

const CSP = {
  connectDomains: [],
  resourceDomains: ['https://cdn.example.com'],
  frameDomains: [],
  baseUriDomains: [],
}
const RESOURCE = { html: '<main>App</main>', csp: CSP, requestedPermissions: [] }

function frameIdOf(call: unknown) {
  return typeof call === 'object' && call !== null && 'frameId' in call ? call.frameId : undefined
}

beforeEach(() => {
  registerMock.mockReset()
  unregisterMock.mockReset()
  registerMock.mockImplementation(async (input: { frameId: string }) => ({
    frameUrl: `openwaggle-mcp-app://frame-${input.frameId}/document`,
    registrationId: `registration-${input.frameId}`,
  }))
  unregisterMock.mockResolvedValue(undefined)
})

describe("an MCP App frame's registration", () => {
  it('registers the App document and its declared origins, and unregisters it when the frame goes', async () => {
    const hook = renderHook(() => useMcpAppFrameRegistration(RESOURCE))

    await waitFor(() =>
      expect(hook.result.current.frameUrl).toMatch(/^openwaggle-mcp-app:\/\/frame-/),
    )
    expect(registerMock).toHaveBeenCalledWith({
      frameId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      html: '<main>App</main>',
      csp: CSP,
    })
    const frameId = frameIdOf(registerMock.mock.calls[0]?.[0])

    hook.unmount()

    expect(unregisterMock).toHaveBeenCalledWith({
      frameId,
      registrationId: `registration-${frameId}`,
    })
  })

  it('registers nothing without a resource', () => {
    const hook = renderHook(() => useMcpAppFrameRegistration(null))

    expect(hook.result.current).toEqual({ frameUrl: null, error: null })
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('leaves no registration behind when the frame goes before the Host answers', async () => {
    let answer: (value: unknown) => void = () => {}
    registerMock.mockImplementationOnce(
      (input: { frameId: string }) =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              frameUrl: `openwaggle-mcp-app://frame-${input.frameId}/document`,
              registrationId: 'late',
            })
        }),
    )
    const hook = renderHook(() => useMcpAppFrameRegistration(RESOURCE))
    const frameId = frameIdOf(registerMock.mock.calls[0]?.[0])

    hook.unmount()
    answer(undefined)

    await waitFor(() =>
      expect(unregisterMock).toHaveBeenCalledWith({ frameId, registrationId: 'late' }),
    )
  })

  it('ends with exactly one live registration under StrictMode', async () => {
    const hook = renderHook(() => useMcpAppFrameRegistration(RESOURCE), { wrapper: StrictMode })

    await waitFor(() => expect(hook.result.current.frameUrl).not.toBeNull())
    await waitFor(() =>
      expect(unregisterMock).toHaveBeenCalledTimes(registerMock.mock.calls.length - 1),
    )
    const live = registerMock.mock.calls
      .map(([input]) => frameIdOf(input))
      .filter((id) => !unregisterMock.mock.calls.some(([input]) => frameIdOf(input) === id))
    expect(live).toHaveLength(1)
    expect(hook.result.current.frameUrl).toBe(
      `openwaggle-mcp-app://frame-${String(live[0])}/document`,
    )
  })

  it('reports a registration the Host refused', async () => {
    registerMock.mockRejectedValueOnce(new Error('MCP App document is too large'))

    const hook = renderHook(() => useMcpAppFrameRegistration(RESOURCE))

    await waitFor(() =>
      expect(hook.result.current).toEqual({
        frameUrl: null,
        error: 'MCP App document is too large',
      }),
    )
  })
})
