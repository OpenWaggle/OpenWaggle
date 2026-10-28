import type { GuiStartupStatus } from '@shared/types/gui-startup'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const startup = vi.hoisted(() => {
  const listeners = new Set<(status: GuiStartupStatus) => void>()
  // A function's declared return type is not narrowed, so the mock can later hold any status.
  const initialStatus = (): GuiStartupStatus => ({ state: 'starting' })
  return {
    listeners,
    status: initialStatus(),
    retryStartup: vi.fn(async () => undefined),
    openLogsDir: vi.fn(async () => undefined),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getStartupStatus: async () => startup.status,
    onStartupStatusChanged: (listener: (status: GuiStartupStatus) => void) => {
      startup.listeners.add(listener)
      return () => startup.listeners.delete(listener)
    },
    retryStartup: startup.retryStartup,
    openLogsDir: startup.openLogsDir,
  },
}))

function publishStartup(status: GuiStartupStatus) {
  startup.status = status
  act(() => {
    for (const listener of [...startup.listeners]) listener(status)
  })
}

const useSettingsSetupMock = vi.fn()
const usePreferencesMock = vi.fn()
const retrySettingsMock = vi.fn()

vi.mock('@/features/settings/hooks/useSettings', () => ({
  useSettingsSetup: () => {
    useSettingsSetupMock()
    return retrySettingsMock
  },
  usePreferences: () => usePreferencesMock(),
}))

vi.mock('@tanstack/react-router', () => ({
  RouterProvider: () => <div data-testid="router-provider">router</div>,
}))

const routeLoad = vi.hoisted(() => ({ settled: true }))

vi.mock('@/router', () => ({
  router: {},
  useInitialRouteLoadSettled: () => routeLoad.settled,
}))

import { App } from '../App'

describe('App', () => {
  beforeEach(() => {
    routeLoad.settled = true
    useSettingsSetupMock.mockReset()
    usePreferencesMock.mockReset()
    retrySettingsMock.mockReset()
    usePreferencesMock.mockReturnValue({ isLoaded: true, loadError: null })
    startup.status = { state: 'starting' }
    startup.listeners.clear()
    startup.retryStartup.mockClear()
    startup.openLogsDir.mockClear()
  })

  it('shows the static startup skeleton, with no spinner, while the Session Host starts', () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })

    const { container } = render(<App />)

    expect(screen.queryByTestId('router-provider')).toBeNull()
    expect(container.querySelector('[data-startup-skeleton]')).not.toBeNull()
    expect(screen.getByRole('main', { name: 'OpenWaggle is starting' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    // Nothing in the frame is actionable or made up.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it("keeps the page's startup frame over the window until the shell is in place (W11)", () => {
    const frame = document.createElement('div')
    frame.id = 'startup-frame'
    document.body.append(frame)
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })

    const { rerender } = render(<App />)
    expect(document.getElementById('startup-frame')).not.toBeNull()
    publishStartup({ state: 'ready' })
    expect(document.getElementById('startup-frame')).not.toBeNull()

    usePreferencesMock.mockReturnValue({ isLoaded: true, loadError: null })
    rerender(<App />)

    expect(screen.getByTestId('router-provider')).toBeInTheDocument()
    expect(document.getElementById('startup-frame')).toBeNull()
  })

  it.each([
    ['the Host error screen', { state: 'failed', reason: 'error', message: 'database is locked' }],
    ['the update notice', { state: 'updating' }],
  ] as const)("uncovers %s, which the page's frame does not show", (_screen, status) => {
    const frame = document.createElement('div')
    frame.id = 'startup-frame'
    document.body.append(frame)
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })
    render(<App />)

    publishStartup(status)

    expect(document.getElementById('startup-frame')).toBeNull()
  })

  it('uncovers the settings error screen', () => {
    const frame = document.createElement('div')
    frame.id = 'startup-frame'
    document.body.append(frame)
    usePreferencesMock.mockReturnValue({ isLoaded: true, loadError: 'database is locked' })

    render(<App />)

    expect(document.getElementById('startup-frame')).toBeNull()
  })

  it('shows the Host error screen with Retry and Open logs instead of quitting', async () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })
    render(<App />)

    publishStartup({ state: 'failed', reason: 'error', message: 'database is locked' })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("OpenWaggle couldn't start its Session Host")
    expect(alert).toHaveTextContent('database is locked')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open logs' }))
    expect(startup.retryStartup).toHaveBeenCalledOnce()
    expect(startup.openLogsDir).toHaveBeenCalledOnce()

    publishStartup({ state: 'starting' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says a Host that is not ready in time is taking too long', () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })
    render(<App />)

    publishStartup({ state: 'failed', reason: 'timeout', message: 'not in time' })

    expect(screen.getByRole('alert')).toHaveTextContent('OpenWaggle is taking too long to start')
  })

  it('says an update is finishing while the Host hands over', () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })
    render(<App />)

    publishStartup({ state: 'updating' })

    expect(screen.getByRole('status')).toHaveTextContent('Finishing an update…')
  })

  it('reads a startup failure that happened before the window subscribed', async () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })
    startup.status = { state: 'failed', reason: 'error', message: 'early failure' }

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('early failure')
  })

  it('blocks the workspace instead of substituting defaults after a settings read failure', () => {
    usePreferencesMock.mockReturnValue({
      isLoaded: true,
      loadError: '/tmp/settings.db unavailable',
    })

    render(<App />)

    expect(screen.queryByTestId('router-provider')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read your settings")
    expect(screen.getByRole('alert')).toHaveTextContent('did not substitute default terminal')
    const retry = screen.getByRole('button', { name: 'Retry loading settings' })
    expect(retry).toBeInTheDocument()

    fireEvent.click(retry)
    expect(retrySettingsMock).toHaveBeenCalledOnce()
  })

  it('renders the route tree after preferences are loaded', () => {
    render(<App />)

    expect(screen.getByTestId('router-provider')).toBeInTheDocument()
  })

  it('keeps the startup view until the launch route has loaded, so the first route render cannot suspend', () => {
    routeLoad.settled = false
    const view = render(<App />)

    expect(screen.queryByTestId('router-provider')).not.toBeInTheDocument()

    routeLoad.settled = true
    view.rerender(<App />)

    expect(screen.getByTestId('router-provider')).toBeInTheDocument()
  })
})
