import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkForUpdatesMock, getSettingsMock, showConfirmMock, updateSettingsMock } = vi.hoisted(
  () => ({
    checkForUpdatesMock: vi.fn(),
    getSettingsMock: vi.fn(),
    showConfirmMock: vi.fn(),
    updateSettingsMock: vi.fn(),
  }),
)

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    checkForUpdates: checkForUpdatesMock,
    getSettings: getSettingsMock,
    showConfirm: showConfirmMock,
    updateSettings: updateSettingsMock,
  },
}))

import { usePreferencesStore } from '../../state/preferences-store'
import { UpdateChannelSetting } from '../sections/UpdateChannelSetting'

describe('UpdateChannelSetting', () => {
  beforeEach(() => {
    checkForUpdatesMock.mockReset().mockResolvedValue(undefined)
    getSettingsMock.mockReset()
    showConfirmMock.mockReset().mockResolvedValue(true)
    updateSettingsMock.mockReset().mockResolvedValue({ ok: true })
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, updateChannel: 'alpha' },
    })
  })

  it('refreshes a CLI-changed channel before applying the same-value shortcut', async () => {
    getSettingsMock.mockResolvedValue({ ...DEFAULT_SETTINGS, updateChannel: 'alpha' })
    render(<UpdateChannelSetting />)

    const channel = screen.getByRole('combobox', { name: 'Update channel' })
    await waitFor(() => expect(channel).toHaveValue('alpha'))

    getSettingsMock.mockResolvedValue({ ...DEFAULT_SETTINGS, updateChannel: 'stable' })
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(channel).toHaveValue('stable'))

    fireEvent.change(channel, { target: { value: 'alpha' } })

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ updateChannel: 'alpha' })
      expect(channel).toHaveValue('alpha')
    })
  })
})
