import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/router', () => ({
  router: {},
}))

import { App } from '../App'

describe('App', () => {
  beforeEach(() => {
    useSettingsSetupMock.mockReset()
    usePreferencesMock.mockReset()
    retrySettingsMock.mockReset()
    usePreferencesMock.mockReturnValue({ isLoaded: true, loadError: null })
  })

  it('renders loading view before preferences are loaded', () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false, loadError: null })

    render(<App />)

    expect(screen.queryByTestId('router-provider')).toBeNull()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
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
})
