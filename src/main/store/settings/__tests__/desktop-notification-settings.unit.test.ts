import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from '@shared/types/desktop-notification'
import { describe, expect, it } from 'vitest'
import { resolveDesktopNotificationSettings } from '../desktop-notification-settings'

describe('resolveDesktopNotificationSettings', () => {
  it('gives an existing install the defaults', () => {
    expect(resolveDesktopNotificationSettings(undefined)).toEqual(
      DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
    )
  })

  it('keeps each valid field and replaces only the invalid ones', () => {
    expect(
      resolveDesktopNotificationSettings({
        enabled: false,
        categories: { 'ready-to-read': false, 'needs-you': 'yes' },
        sounds: { 'needs-you': 'bell', 'agent-errors': 'kazoo' },
        whileFocused: 'show',
        mutedSessionIds: ['a', 7, 'b'],
      }),
    ).toMatchObject({
      enabled: false,
      categories: { 'ready-to-read': false, 'needs-you': true },
      sounds: { 'needs-you': 'bell', 'agent-errors': 'low-tone' },
      whileFocused: 'show',
      mutedSessionIds: ['a', 'b'],
    })
  })
})
