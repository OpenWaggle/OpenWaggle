import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingsMock, updateSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: getSettingsMock,
    updateSettings: updateSettingsMock,
  },
}))

import { usePreferencesStore } from '../../state/preferences-store'
import { AgentToolsSettings } from '../sections/AgentToolsSettings'

const CODEMODE_SWITCH = 'Codemode'

describe('AgentToolsSettings', () => {
  beforeEach(() => {
    getSettingsMock.mockReset().mockResolvedValue(DEFAULT_SETTINGS)
    updateSettingsMock.mockReset().mockResolvedValue({ ok: true })
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('shows codemode on by default', () => {
    render(<AgentToolsSettings />)

    expect(screen.getByRole('switch', { name: CODEMODE_SWITCH })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('saves turning codemode off', async () => {
    render(<AgentToolsSettings />)

    fireEvent.click(screen.getByRole('switch', { name: CODEMODE_SWITCH }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ codemodeEnabled: false })
      expect(screen.getByRole('switch', { name: CODEMODE_SWITCH })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    })
  })

  it('shows prompt cache warming while the agent works by default and saves a new choice', async () => {
    render(<AgentToolsSettings />)

    expect(screen.getByRole('radio', { name: 'While working' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ cacheWarming: 'off' })
      expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('offers keeping the cache warm between Runs', async () => {
    render(<AgentToolsSettings />)

    fireEvent.click(screen.getByRole('radio', { name: 'Between runs' }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ cacheWarming: 'idle' })
      expect(screen.getByRole('radio', { name: 'Between runs' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })
  })
})
