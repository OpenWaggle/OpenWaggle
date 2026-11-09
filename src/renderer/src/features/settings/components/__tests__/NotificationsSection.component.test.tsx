import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const { updateSettingsMock, permissionMock, sendTestMock } = vi.hoisted(() => ({
  updateSettingsMock: vi.fn(),
  permissionMock: vi.fn(),
  sendTestMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSettings: updateSettingsMock,
    getDesktopNotificationPermissionStatus: permissionMock,
    sendTestDesktopNotification: sendTestMock,
    openDesktopNotificationSystemSettings: vi.fn().mockResolvedValue(undefined),
    onDesktopNotificationPermissionChanged: vi.fn(() => () => undefined),
  },
}))

import { usePreferencesStore } from '../../state/preferences-store'
import { NotificationsSection } from '../sections/NotificationsSection'

describe('NotificationsSection', () => {
  beforeEach(() => {
    updateSettingsMock.mockReset().mockResolvedValue({ ok: true })
    permissionMock.mockReset().mockResolvedValue('blocked')
    sendTestMock.mockReset().mockResolvedValue('blocked')
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        desktopNotifications: {
          ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
          mutedProjectPaths: ['/work/openwaggle'],
        },
      },
    })
  })

  it('shows every category on, the system permission and the muted project', async () => {
    renderWithQueryClient(<NotificationsSection />)

    for (const name of ['Needs you', 'Ready to read', 'Failed or interrupted', 'Agent errors']) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true')
    }
    expect(await screen.findByText(/Blocked by the system/u)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'While OpenWaggle is focused' })).toHaveValue(
      'sound-only',
    )
    expect(screen.getByText('openwaggle')).toBeInTheDocument()
    // The badge counts every kind that is on, not only Needs you and Ready to read.
    expect(
      screen.getByText(
        'Count your notifications on the app icon, for every kind turned on. Windows shows a dot.',
      ),
    ).toBeInTheDocument()
  })

  it('saves a category switch and a sound with the rest of the settings', async () => {
    renderWithQueryClient(<NotificationsSection />)

    fireEvent.click(screen.getByRole('switch', { name: 'Ready to read' }))
    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        desktopNotifications: expect.objectContaining({
          categories: expect.objectContaining({ 'ready-to-read': false, 'needs-you': true }),
        }),
      }),
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Needs you sound' }), {
      target: { value: 'bell' },
    })
    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenLastCalledWith({
        desktopNotifications: expect.objectContaining({
          sounds: expect.objectContaining({ 'needs-you': 'bell' }),
        }),
      }),
    )
  })

  it('unmutes a project', async () => {
    renderWithQueryClient(<NotificationsSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        desktopNotifications: expect.objectContaining({ mutedProjectPaths: [] }),
      }),
    )
  })
})
