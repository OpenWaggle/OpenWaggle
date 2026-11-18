import type { DesktopNotificationPermissionStatus } from '@shared/types/desktop-notification'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { useOpenScheduledTask } from '@/features/scheduled-tasks'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'
import { playNotificationSound } from '../lib/notification-sounds'
import { useDesktopNotificationViewing } from './useDesktopNotificationViewing'

const logger = createRendererLogger('desktop-notifications')

export const DesktopNotificationBlockedNoticeCopy = {
  message:
    'macOS is blocking OpenWaggle notifications. Sounds, the Dock badge and the sidebar still tell you when a Session needs you.',
  action: 'Settings',
} as const

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The window's side of Desktop notifications (ADR 0062): plays the Notification sound the desktop
 * app asks for, opens a Scheduled task a notification was about, and says once when macOS blocks
 * notifications.
 */
export function useDesktopNotificationsMonitor() {
  useDesktopNotificationViewing()
  const navigate = useNavigate()
  const openScheduledTask = useOpenScheduledTask()
  const openTask = useEffectEvent((taskId: string) => openScheduledTask(taskId))
  const announceBlocked = useEffectEvent((status: DesktopNotificationPermissionStatus) => {
    if (status !== 'blocked') return
    const { settings, setDesktopNotifications } = usePreferencesStore.getState()
    const preferences = settings.desktopNotifications
    if (preferences.blockedNoticeShown || !preferences.enabled) return
    void setDesktopNotifications({ ...preferences, blockedNoticeShown: true }).catch(
      (error: unknown) =>
        logger.warn('Could not record the blocked notice', { error: describe(error) }),
    )
    useUIStore.getState().showActionToast({
      message: DesktopNotificationBlockedNoticeCopy.message,
      variant: 'neutral',
      action: {
        label: DesktopNotificationBlockedNoticeCopy.action,
        onClick: () => void navigate({ to: '/settings/$tab', params: { tab: 'notifications' } }),
      },
    })
  })

  useEffect(() => {
    const releaseSound = api.onDesktopNotificationSound(({ sound }) => {
      void playNotificationSound(sound).catch((error: unknown) =>
        logger.warn('Could not play a Notification sound', { error: describe(error) }),
      )
    })
    const releaseTask = api.onDesktopNotificationOpenScheduledTask(({ taskId }) => openTask(taskId))
    const releasePermission = api.onDesktopNotificationPermissionChanged(announceBlocked)
    return () => {
      releaseSound()
      releaseTask()
      releasePermission()
    }
  }, [])
}
