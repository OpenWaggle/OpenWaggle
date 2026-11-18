import { DESKTOP_NOTIFICATION_MUTE_LIMIT } from '@shared/types/desktop-notification'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('desktop-notifications')

type MuteList = 'mutedSessionIds' | 'mutedProjectPaths'

function toggled(list: readonly string[], key: string) {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key]
}

/**
 * A Notification mute for one Session or project (CONTEXT.md): it silences everything but Needs
 * you, until the person removes it.
 */
function useNotificationMute(list: MuteList, key: string | null) {
  const muted = usePreferencesStore((state) =>
    key === null ? false : state.settings.desktopNotifications[list].includes(key),
  )
  const toggle = () => {
    if (key === null) return
    const { settings, setDesktopNotifications } = usePreferencesStore.getState()
    const preferences = settings.desktopNotifications
    const next = toggled(preferences[list], key)
    if (next.length > DESKTOP_NOTIFICATION_MUTE_LIMIT) {
      useUIStore.getState().showToast('Too many muted items. Unmute some in Settings.', 'error')
      return
    }
    void setDesktopNotifications({ ...preferences, [list]: next }).catch((error: unknown) => {
      logger.warn('Could not change a notification mute', {
        error: error instanceof Error ? error.message : String(error),
      })
      useUIStore.getState().showToast('Could not change the notification mute.', 'error')
    })
  }
  return { muted, toggle }
}

export function useSessionNotificationMute(sessionId: string | null) {
  return useNotificationMute('mutedSessionIds', sessionId)
}

export function useProjectNotificationMute(projectPath: string | null) {
  return useNotificationMute('mutedProjectPaths', projectPath)
}
