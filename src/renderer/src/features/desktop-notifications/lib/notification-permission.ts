import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('desktop-notifications')

let requested = false

/**
 * At the first Run the person starts in the app, ask the operating system once whether OpenWaggle
 * may show notifications (ADR 0062). Never asked from a notification that came due while away.
 */
export function requestDesktopNotificationPermissionOnce() {
  if (requested) return
  const preferences = usePreferencesStore.getState().settings.desktopNotifications
  if (!preferences.enabled || preferences.permissionRequested) return
  requested = true
  // Sending a message never waits for, or fails because of, the permission request.
  void Promise.resolve()
    .then(() => api.requestDesktopNotificationPermission())
    .then(() => {
      // The desktop app saved this; keep the window's copy in step so a later save keeps it.
      usePreferencesStore.setState((state) => ({
        settings: {
          ...state.settings,
          desktopNotifications: {
            ...state.settings.desktopNotifications,
            permissionRequested: true,
            introductionShown: true,
          },
        },
      }))
    })
    .catch((error: unknown) => {
      logger.warn('Could not ask for notification permission', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
}
