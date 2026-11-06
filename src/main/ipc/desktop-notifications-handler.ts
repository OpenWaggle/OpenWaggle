import { desktopNotificationSessionIdSchema } from '@shared/schemas/desktop-notification'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { getSettingsOperation } from '../application/settings-operations'
import {
  desktopNotificationPermissionStatus,
  requestDesktopNotificationPermission,
  sendTestDesktopNotification,
  setDesktopNotificationViewingSession,
} from '../desktop-notification-presenter'
import { openSystemNotificationSettings } from '../desktop-ui'
import { SettingsService } from '../services/settings-service'
import { hostHandle, typedHandle, typedOn } from './typed-ipc'

const decodeViewingSession = Schema.decodeUnknown(Schema.NullOr(desktopNotificationSessionIdSchema))

/** Settings → Notifications and the desktop app's side of Desktop notifications (ADR 0062). */
export function registerDesktopNotificationsHandlers() {
  hostHandle('desktop-notifications:list')
  typedHandle('desktop-notifications:get-permission-status', () =>
    Effect.sync(desktopNotificationPermissionStatus),
  )
  typedHandle('desktop-notifications:request-permission', () =>
    Effect.gen(function* () {
      const settings = yield* SettingsService
      const current = yield* settings.get()
      if (current.desktopNotifications.permissionRequested) {
        return desktopNotificationPermissionStatus()
      }
      yield* settings.update({
        desktopNotifications: {
          ...current.desktopNotifications,
          permissionRequested: true,
          // The first notification says where the settings are.
          introductionShown: true,
        },
      })
      yield* getSettingsOperation()
      return requestDesktopNotificationPermission()
    }),
  )
  typedHandle('desktop-notifications:send-test', () => Effect.sync(sendTestDesktopNotification))
  typedHandle('desktop-notifications:open-system-settings', () =>
    Effect.promise(() => openSystemNotificationSettings()).pipe(Effect.as(undefined)),
  )
  typedOn('desktop-notifications:set-viewing-session', (_event, rawSessionId: unknown) =>
    decodeViewingSession(rawSessionId).pipe(
      Effect.map(setDesktopNotificationViewingSession),
      Effect.orElse(() => Effect.void),
    ),
  )
}
