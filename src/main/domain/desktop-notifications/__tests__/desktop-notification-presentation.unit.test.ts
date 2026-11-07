import {
  DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  type DesktopNotification,
} from '@shared/types/desktop-notification'
import { describe, expect, it } from 'vitest'
import {
  desktopNotificationBadgeCount,
  desktopNotificationPresentation,
} from '../desktop-notification-presentation'

const NOTIFICATION: DesktopNotification = {
  id: 'session:root',
  revision: 1,
  target: { kind: 'session', sessionId: 'root' },
  category: 'ready-to-read',
  reason: 'completed',
  title: 'Root · openwaggle',
  body: 'Ready to read',
  createdAt: 1,
  presentedBy: 'desktop',
}

const UNFOCUSED = { focused: false, viewingSessionId: 'root', windowAvailable: true }
const ELSEWHERE = { focused: true, viewingSessionId: 'other', windowAvailable: true }

describe('desktopNotificationPresentation', () => {
  it('shows it with the app sound when unfocused, even for the Session on screen', () => {
    expect(
      desktopNotificationPresentation(
        NOTIFICATION,
        DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
        UNFOCUSED,
      ),
    ).toEqual({ show: true, systemSound: false, appSound: 'pop' })
  })

  it('does nothing while the person looks at that Session', () => {
    expect(
      desktopNotificationPresentation(NOTIFICATION, DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, {
        ...UNFOCUSED,
        focused: true,
      }),
    ).toEqual({ show: false, systemSound: false, appSound: null })
  })

  it('follows "While OpenWaggle is focused" for another Session', () => {
    const settings = DEFAULT_DESKTOP_NOTIFICATION_SETTINGS
    expect(desktopNotificationPresentation(NOTIFICATION, settings, ELSEWHERE)).toEqual({
      show: false,
      systemSound: false,
      appSound: 'pop',
    })
    expect(
      desktopNotificationPresentation(
        NOTIFICATION,
        { ...settings, whileFocused: 'show' },
        ELSEWHERE,
      ),
    ).toEqual({ show: true, systemSound: false, appSound: 'pop' })
    expect(
      desktopNotificationPresentation(
        NOTIFICATION,
        { ...settings, whileFocused: 'nothing' },
        ELSEWHERE,
      ),
    ).toEqual({ show: false, systemSound: false, appSound: null })
  })

  it('lets the system play the sound when it is the System default or no window can', () => {
    const settings = {
      ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
      sounds: {
        ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.sounds,
        'ready-to-read': 'system' as const,
      },
    }
    expect(desktopNotificationPresentation(NOTIFICATION, settings, UNFOCUSED)).toEqual({
      show: true,
      systemSound: true,
      appSound: null,
    })
    expect(
      desktopNotificationPresentation(NOTIFICATION, DEFAULT_DESKTOP_NOTIFICATION_SETTINGS, {
        ...UNFOCUSED,
        windowAvailable: false,
      }),
    ).toEqual({ show: true, systemSound: true, appSound: null })
  })

  it('presents nothing the Host already showed, or a category switched off', () => {
    const settings = DEFAULT_DESKTOP_NOTIFICATION_SETTINGS
    expect(
      desktopNotificationPresentation({ ...NOTIFICATION, presentedBy: 'host' }, settings, UNFOCUSED)
        .show,
    ).toBe(false)
    expect(
      desktopNotificationPresentation(
        NOTIFICATION,
        { ...settings, categories: { ...settings.categories, 'ready-to-read': false } },
        UNFOCUSED,
      ).show,
    ).toBe(false)
  })
})

describe('desktopNotificationBadgeCount', () => {
  it('counts outstanding notifications whose category is on, and nothing with the badge off', () => {
    const settings = DEFAULT_DESKTOP_NOTIFICATION_SETTINGS
    const needsYou = { ...NOTIFICATION, id: 'session:b', category: 'needs-you' as const }
    expect(desktopNotificationBadgeCount([NOTIFICATION, needsYou], settings)).toBe(2)
    expect(
      desktopNotificationBadgeCount([NOTIFICATION, needsYou], {
        ...settings,
        categories: { ...settings.categories, 'ready-to-read': false },
      }),
    ).toBe(1)
    expect(desktopNotificationBadgeCount([NOTIFICATION], { ...settings, showBadge: false })).toBe(0)
  })
})
