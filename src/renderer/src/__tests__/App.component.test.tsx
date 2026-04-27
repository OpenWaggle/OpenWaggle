import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useSettingsSetupMock = vi.fn()
const usePreferencesMock = vi.fn()

vi.mock('@/hooks/useSettings', () => ({
  useSettingsSetup: (): void => {
    useSettingsSetupMock()
  },
  usePreferences: (): ReturnType<typeof usePreferencesMock> => usePreferencesMock(),
}))

vi.mock('@tanstack/react-router', () => ({
  RouterProvider: () => <div data-testid="router-provider">router</div>,
}))

vi.mock('@/router', () => ({
  router: {},
}))

import { App } from '@/App'

describe('App', () => {
  beforeEach(() => {
    useSettingsSetupMock.mockReset()
    usePreferencesMock.mockReset()
    usePreferencesMock.mockReturnValue({ isLoaded: true })
  })

  it('renders loading view before preferences are loaded', () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false })

    render(<App />)

    expect(screen.queryByTestId('router-provider')).toBeNull()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders the route tree after preferences are loaded', () => {
    render(<App />)

    expect(screen.getByTestId('router-provider')).toBeInTheDocument()
  })
})
