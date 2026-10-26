import { USAGE_STATISTICS_DOCS_URL } from '@shared/constants/usage-statistics'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const { getSettingsMock, updateSettingsMock, getUsageStatisticsBlockMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  getUsageStatisticsBlockMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: getSettingsMock,
    updateSettings: updateSettingsMock,
    getUsageStatisticsBlock: getUsageStatisticsBlockMock,
  },
}))

import { usePreferencesStore } from '../../state/preferences-store'
import { UsageStatisticsSetting } from '../sections/UsageStatisticsSetting'

const SWITCH_NAME = 'Share anonymous usage statistics and error reports'

/** The switch once the GUI has said whether its build or environment turns statistics off. */
async function readySwitch() {
  const toggle = screen.getByRole('switch', { name: SWITCH_NAME })
  await waitFor(() => expect(toggle).not.toBeDisabled())
  return toggle
}

describe('UsageStatisticsSetting', () => {
  beforeEach(() => {
    getSettingsMock.mockReset().mockResolvedValue(DEFAULT_SETTINGS)
    updateSettingsMock.mockReset().mockResolvedValue({ ok: true })
    getUsageStatisticsBlockMock.mockReset().mockResolvedValue(null)
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('shows statistics as on by default and links to what is sent', async () => {
    renderWithQueryClient(<UsageStatisticsSetting />)

    expect(await readySwitch()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('link', { name: /What is sent/u })).toHaveAttribute(
      'href',
      USAGE_STATISTICS_DOCS_URL,
    )
  })

  it('persists turning statistics off', async () => {
    renderWithQueryClient(<UsageStatisticsSetting />)

    fireEvent.click(await readySwitch())

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
    renderWithQueryClient(<UsageStatisticsSetting />)

    const toggle = await readySwitch()
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ usageStatisticsEnabled: true })
      expect(toggle).not.toBeDisabled()
    })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps the switch disabled until it knows whether this build may send anything', () => {
    getUsageStatisticsBlockMock.mockReturnValue(new Promise(() => {}))
    renderWithQueryClient(<UsageStatisticsSetting />)

    expect(screen.getByRole('switch', { name: SWITCH_NAME })).toBeDisabled()
  })

  it.each([
    ['dev-build', 'Off in development builds, which never send statistics or error reports.'],
    ['automation', 'Off while OpenWaggle runs for automated testing.'],
    ['do-not-track', 'Off because DO_NOT_TRACK is set in the environment OpenWaggle started with.'],
    ['ci', 'Off because the CI variable is set in the environment OpenWaggle started with.'],
  ])(
    'shows the switch off and disabled with the reason when %s turns statistics off',
    async (block, reason) => {
      getUsageStatisticsBlockMock.mockResolvedValue(block)
      renderWithQueryClient(<UsageStatisticsSetting />)

      expect(await screen.findByText(reason)).toBeInTheDocument()
      const toggle = screen.getByRole('switch', { name: SWITCH_NAME })
      expect(toggle).toHaveAttribute('aria-checked', 'false')
      expect(toggle).toBeDisabled()
      fireEvent.click(toggle)
      expect(updateSettingsMock).not.toHaveBeenCalled()
      // The saved choice is untouched; it applies again where nothing turns statistics off.
      expect(usePreferencesStore.getState().settings.usageStatisticsEnabled).toBe(true)
    },
  )
})
