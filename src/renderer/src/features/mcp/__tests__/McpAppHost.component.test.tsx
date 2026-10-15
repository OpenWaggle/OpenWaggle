import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridgeMock = vi.hoisted(() => vi.fn<(input: unknown, layout: unknown) => void>())
const setComposerTextValueMock = vi.hoisted(() => vi.fn())

vi.mock('../mcp-app-bridge', () => ({ useMcpAppBridge: bridgeMock }))
// One resource, as the real hook keeps it across renders once loaded.
const loadedResource = vi.hoisted(() => ({
  resource: {
    html: '<main>Weather</main>',
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    requestedPermissions: [],
  },
  error: null,
}))
vi.mock('../use-mcp-app-resource', () => ({ useMcpAppResource: () => loadedResource }))
const FRAME_URL = 'openwaggle-mcp-app://frame-12345678-1234-4123-8123-123456789abc/document'
const registration: { frameUrl: string | null; error: string | null } = vi.hoisted(() => ({
  frameUrl: null,
  error: null,
}))
vi.mock('../use-mcp-app-frame-registration', () => ({
  useMcpAppFrameRegistration: () => ({
    frameUrl: registration.frameUrl,
    error: registration.error,
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

interface ReadyBridgeInput {
  readonly onHeightChange: (height: number) => void
  readonly onInitialized: () => void
}

function isReadyBridgeInput(value: unknown): value is ReadyBridgeInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'onHeightChange' in value &&
    typeof value.onHeightChange === 'function' &&
    'onInitialized' in value &&
    typeof value.onInitialized === 'function'
  )
}

/** The bridge input of the frame once it loaded, with the App's callbacks. */
function readyBridgeInput() {
  const input = bridgeMock.mock.calls.map(([value]) => value).findLast(isReadyBridgeInput)
  if (!input) throw new Error('Expected the ready MCP App bridge input.')
  return input
}

const DESCRIPTOR = {
  serverInstanceId: 'server-1',
  serverConfigHash: 'server-config-hash',
  serverLabel: 'weather',
  toolHandle: 'weather_handle',
  toolName: 'show_weather',
  toolTitle: 'Show weather',
  resourceUri: 'ui://weather/app',
}

function renderLoadedApp() {
  render(<McpAppHost descriptor={DESCRIPTOR} projectPath="/project" sessionId="session-1" />)
  const frame = screen.getByTitle('Show weather MCP App')
  fireEvent.load(frame)
  return frame
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  bridgeMock.mockClear()
  registration.frameUrl = FRAME_URL
  registration.error = null
})
registration.frameUrl = FRAME_URL

describe('McpAppHost frame size', () => {
  it('loads the App from its own frame origin, not from the page', () => {
    const frame = renderLoadedApp()

    expect(frame).toHaveAttribute('src', FRAME_URL)
    expect(frame).not.toHaveAttribute('srcdoc')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
  })

  it('leaves no empty box while the App starts', () => {
    const frame = renderLoadedApp()

    expect(screen.getByText('Starting MCP App…')).toBeInTheDocument()
    expect(frame).toHaveStyle({ height: '1px' })
  })

  it('takes the height the App reports for its data, within bounds', () => {
    const frame = renderLoadedApp()
    const app = readyBridgeInput()

    act(() => app.onHeightChange(132))
    expect(frame).toHaveStyle({ height: '132px' })
    expect(screen.queryByText('Starting MCP App…')).not.toBeInTheDocument()

    act(() => app.onHeightChange(4))
    expect(frame).toHaveStyle({ height: '48px' })
    act(() => app.onHeightChange(5000))
    expect(frame).toHaveStyle({ height: '800px' })
  })

  it('gives an App that runs but never reports its size a default height', () => {
    const frame = renderLoadedApp()

    act(() => readyBridgeInput().onInitialized())

    expect(frame).toHaveStyle({ height: '320px' })
  })

  it('says so, instead of a blank frame, when the App never starts', () => {
    vi.useFakeTimers()
    renderLoadedApp()

    act(() => vi.advanceTimersByTime(15_000))

    expect(screen.getByRole('status')).toHaveTextContent('This MCP App did not start.')
    expect(screen.queryByTitle('Show weather MCP App')).not.toBeInTheDocument()
  })

  it('keeps an App that started in time', () => {
    vi.useFakeTimers()
    const frame = renderLoadedApp()
    act(() => readyBridgeInput().onHeightChange(200))

    act(() => vi.advanceTimersByTime(30_000))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(frame).toHaveStyle({ height: '200px' })
  })
})

describe('McpAppHost layout', () => {
  it("measures the panel width once the App's document is registered, as it is in the app", () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(DOMRect.fromRect({ width: 640, height: 10 }))
    registration.frameUrl = null
    const view = render(
      <McpAppHost descriptor={DESCRIPTOR} projectPath="/project" sessionId="session-1" />,
    )
    expect(screen.queryByTitle('Show weather MCP App')).not.toBeInTheDocument()

    registration.frameUrl = FRAME_URL
    view.rerender(
      <McpAppHost descriptor={DESCRIPTOR} projectPath="/project" sessionId="session-1" />,
    )

    expect(bridgeMock.mock.calls.at(-1)?.[1]).toMatchObject({ width: 640 })
    rect.mockRestore()
  })

  it('keeps one bridge while the App starts, runs, and resizes', () => {
    renderLoadedApp()
    const first = readyBridgeInput()

    act(() => first.onInitialized())
    act(() => first.onHeightChange(240))

    expect(readyBridgeInput()).toBe(first)
  })

  it('says why when the Host refuses to serve the App document', () => {
    registration.frameUrl = null
    registration.error = 'MCP App document is too large'

    render(<McpAppHost descriptor={DESCRIPTOR} projectPath="/project" sessionId="session-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'MCP App could not load: MCP App document is too large',
    )
    expect(screen.queryByTitle('Show weather MCP App')).not.toBeInTheDocument()
  })

  it('connects a new bridge when the App reloads its document', () => {
    const frame = renderLoadedApp()
    const first = readyBridgeInput()

    fireEvent.load(frame)

    expect(readyBridgeInput()).not.toBe(first)
  })
})

describe('McpAppHost', () => {
  it('shows staged context through the structured adapter before adding it to a draft', async () => {
    render(
      <McpAppHost
        descriptor={{
          serverInstanceId: 'server-1',
          serverConfigHash: 'server-config-hash',
          serverLabel: 'weather',
          toolHandle: 'weather_handle',
          toolName: 'show_weather',
          toolTitle: 'Show weather',
          resourceUri: 'ui://weather/app',
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
