import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { UpdateStatus } from '@shared/types/updater'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUpdateStatusMock } = vi.hoisted(() => ({ getUpdateStatusMock: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getAppVersion: vi.fn(async () => '0.2.0'),
    getUpdateStatus: getUpdateStatusMock,
    onUpdateStatus: vi.fn(() => () => {}),
    checkForUpdates: vi.fn(async () => undefined),
    installUpdate: vi.fn(async () => undefined),
    updateSettings: vi.fn(async () => ({ ok: true })),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    getCliShimStatus: vi.fn(async () => ({
      management: 'user-shim',
      state: 'installed',
      commandPath: '/tmp/openwaggle',
      onPath: true,
    })),
    showConfirm: vi.fn(async () => true),
  },
}))

vi.mock('../sections/AgentAccessSection', () => ({ AgentAccessSection: () => null }))

import { usePreferencesStore } from '../../state/preferences-store'
import { GeneralSection } from '../sections/GeneralSection'

describe('GeneralSection update install', () => {
  beforeEach(() => {
    getUpdateStatusMock.mockReset()
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('shows the update installing, with nothing left to click, once the restart begins', async () => {
    getUpdateStatusMock.mockResolvedValue({
      type: 'installing',
      version: '0.3.0',
    } satisfies UpdateStatus)

    render(<GeneralSection />)

    expect(
      await screen.findByText(/^Installing v0\.3\.0\. .* reopens when it is done$/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /restart to update/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument()
  })

  it('explains why the previous restart did not install and offers it again', async () => {
    getUpdateStatusMock.mockResolvedValue({
      type: 'downloaded',
      version: '0.3.0',
      installFailure: 'Version 0.3.0 did not finish installing. Restart to update to try again.',
    } satisfies UpdateStatus)

    render(<GeneralSection />)

    expect(
      await screen.findByText(
        'Version 0.3.0 did not finish installing. Restart to update to try again.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /restart to update/i })).toBeInTheDocument()
  })
})
