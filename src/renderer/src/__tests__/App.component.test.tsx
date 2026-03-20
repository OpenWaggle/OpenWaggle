import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useSettingsSetupMock = vi.fn()
const usePreferencesMock = vi.fn()

let activeView: 'chat' | 'skills' | 'mcps' | 'settings' = 'chat'

vi.mock('@/hooks/useSettings', () => ({
  useSettingsSetup: (): void => {
    useSettingsSetupMock()
  },
  usePreferences: (): ReturnType<typeof usePreferencesMock> => usePreferencesMock(),
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: (
    selector: (state: { activeView: 'chat' | 'skills' | 'mcps' | 'settings' }) => unknown,
  ) => selector({ activeView }),
}))

vi.mock('@/components/app/workspace/WorkspaceShell', () => ({
  WorkspaceShell: () => <div data-testid="workspace-shell">workspace</div>,
}))

vi.mock('@/components/app/AppSettingsView', () => ({
  AppSettingsView: () => <div data-testid="settings-overlay">settings</div>,
}))

import { App } from '@/App'

describe('App', () => {
  beforeEach(() => {
    activeView = 'chat'
    useSettingsSetupMock.mockReset()
    usePreferencesMock.mockReset()
    usePreferencesMock.mockReturnValue({ isLoaded: true })
  })

  it('renders loading view before preferences are loaded', () => {
    usePreferencesMock.mockReturnValue({ isLoaded: false })

    render(<App />)

    expect(screen.queryByTestId('workspace-shell')).toBeNull()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('keeps workspace mounted while settings overlay is open', () => {
    activeView = 'settings'

    render(<App />)

    expect(screen.getByTestId('workspace-shell')).toBeInTheDocument()
    expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
  })
})
