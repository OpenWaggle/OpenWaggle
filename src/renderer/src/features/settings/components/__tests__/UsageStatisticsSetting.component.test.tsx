import { USAGE_STATISTICS_DOCS_URL } from '@shared/constants/usage-statistics'
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
import { UsageStatisticsSetting } from '../sections/UsageStatisticsSetting'

const SWITCH_NAME = 'Share anonymous usage statistics and error reports'

describe('UsageStatisticsSetting', () => {
  beforeEach(() => {
    getSettingsMock.mockReset().mockResolvedValue(DEFAULT_SETTINGS)
    updateSettingsMock.mockReset().mockResolvedValue({ ok: true })
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('shows statistics as on by default and links to what is sent', () => {
    render(<UsageStatisticsSetting />)

    expect(screen.getByRole('switch', { name: SWITCH_NAME })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('link', { name: /What is sent/u })).toHaveAttribute(
      'href',
      USAGE_STATISTICS_DOCS_URL,
    )
  })

  it('persists turning statistics off', async () => {
    render(<UsageStatisticsSetting />)

    fireEvent.click(screen.getByRole('switch', { name: SWITCH_NAME }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ usageStatisticsEnabled: false })
      expect(screen.getByRole('switch', { name: SWITCH_NAME })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    })
  })

  it('keeps the saved value when the Session Host rejects the change', async () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, usageStatisticsEnabled: false },
    })
    updateSettingsMock.mockResolvedValue({ ok: false, error: 'Host rejected settings' })
    render(<UsageStatisticsSetting />)

    const toggle = screen.getByRole('switch', { name: SWITCH_NAME })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ usageStatisticsEnabled: true })
      expect(toggle).not.toBeDisabled()
    })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })
})
