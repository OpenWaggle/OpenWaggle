import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateSettingsMock, setProjectMcpSettingsMock } = vi.hoisted(() => ({
  updateSettingsMock: vi.fn(),
  setProjectMcpSettingsMock: vi.fn(),
}))

vi.mock('../../../lib/ipc', () => ({
  api: {
    updateSettings: updateSettingsMock,
    setProjectMcpSettings: setProjectMcpSettingsMock,
  },
}))

import { usePreferencesStore } from '../../../stores/preferences-store'
import { ConfigurationSection } from '../sections/ConfigurationSection'

describe('ConfigurationSection', () => {
  beforeEach(() => {
    updateSettingsMock.mockReset()
    setProjectMcpSettingsMock.mockReset()
    updateSettingsMock.mockResolvedValue({ ok: true })
    setProjectMcpSettingsMock.mockResolvedValue(undefined)
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: '/tmp/repo',
        mcpDefault: 'enabled',
      },
      projectMcpSettings: { enabled: 'inherit' },
      isLoaded: true,
      loadError: null,
    })
  })

  it('shows MCP as enabled when the project inherits the enabled global default', () => {
    render(<ConfigurationSection />)

    expect(screen.getAllByText('Enabled')[0]).toBeInTheDocument()
    expect(screen.getByText('MCP Extension')).toBeInTheDocument()
  })

  it('persists global MCP default changes', async () => {
    render(<ConfigurationSection />)

    const [globalSelect] = screen.getAllByRole('combobox')
    fireEvent.change(globalSelect, { target: { value: 'disabled' } })

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ mcpDefault: 'disabled' })
    })
    expect(usePreferencesStore.getState().settings.mcpDefault).toBe('disabled')
  })

  it('persists project MCP override changes', async () => {
    render(<ConfigurationSection />)

    const [, projectSelect] = screen.getAllByRole('combobox')
    fireEvent.change(projectSelect, { target: { value: 'disabled' } })

    await waitFor(() => {
      expect(setProjectMcpSettingsMock).toHaveBeenCalledWith('/tmp/repo', {
        enabled: 'disabled',
      })
    })
    expect(usePreferencesStore.getState().projectMcpSettings).toEqual({ enabled: 'disabled' })
  })
})
