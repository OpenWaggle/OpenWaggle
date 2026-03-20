import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDevtoolsEventBusConfigMock = vi.fn(async () => ({
  enabled: true,
  host: 'localhost',
  port: 4206,
  protocol: 'http' as const,
}))

const tanStackDevtoolsMock = vi.fn(({ eventBusConfig }: { eventBusConfig: unknown }) => (
  <div data-testid="tanstack-devtools">{JSON.stringify(eventBusConfig)}</div>
))

const aiDevtoolsPluginMock = vi.fn(() => ({ name: 'ai-devtools-plugin' }))

vi.mock('@tanstack/react-devtools', () => ({
  TanStackDevtools: tanStackDevtoolsMock,
}))

vi.mock('@tanstack/react-ai-devtools', () => ({
  aiDevtoolsPlugin: aiDevtoolsPluginMock,
}))

function setRuntimeApi() {
  window.api = {
    getDevtoolsEventBusConfig: getDevtoolsEventBusConfigMock,
  } as typeof window.api
}

describe('TanStackAIDevtools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    setRuntimeApi()
  })

  it('stays hidden by default in development until explicitly enabled', async () => {
    const { TanStackAIDevtools } = await import('../TanStackAIDevtools')

    render(<TanStackAIDevtools />)

    expect(screen.queryByTestId('tanstack-devtools')).not.toBeInTheDocument()
    expect(getDevtoolsEventBusConfigMock).not.toHaveBeenCalled()
  })

  it('renders and fetches event-bus config when explicitly enabled', async () => {
    localStorage.setItem('openwaggle.tanstackDevtools', '1')
    const { TanStackAIDevtools } = await import('../TanStackAIDevtools')

    render(<TanStackAIDevtools />)

    await waitFor(() => {
      expect(screen.getByTestId('tanstack-devtools')).toBeInTheDocument()
    })

    expect(getDevtoolsEventBusConfigMock).toHaveBeenCalledTimes(1)
    expect(aiDevtoolsPluginMock).toHaveBeenCalled()
  })
})
