import {
  DESKTOP_NOTIFICATION_CATEGORIES,
  type DesktopNotificationCategory,
  type DesktopNotificationFocusedBehavior,
  type DesktopNotificationSettings,
} from '@shared/types/desktop-notification'
import { BellOff } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { SettingsSectionContainer } from '../SettingsSectionContainer'
import { MutedList } from './notifications/NotificationMutedList'
import { describe, PermissionCard } from './notifications/NotificationPermissionCard'
import { Row } from './notifications/NotificationSettingRow'
import { SoundPicker } from './notifications/NotificationSoundPicker'

const logger = createRendererLogger('settings/notifications')

const CATEGORY_COPY: Readonly<
  Record<DesktopNotificationCategory, { readonly label: string; readonly description: string }>
> = {
  'needs-you': {
    label: 'Needs you',
    description: 'A Session waits for your approval or answer, or a Worker is Stuck.',
  },
  'ready-to-read': {
    label: 'Ready to read',
    description: 'A Run you or a Scheduled task started finished.',
  },
  'failed-or-interrupted': {
    label: 'Failed or interrupted',
    description: 'A Run failed, stopped waiting for you, or was cut off.',
  },
  'agent-errors': {
    label: 'Agent errors',
    description: 'An agent or extension reported an error.',
  },
}

const FOCUSED_OPTIONS: readonly {
  readonly value: DesktopNotificationFocusedBehavior
  readonly label: string
}[] = [
  { value: 'sound-only', label: 'Sound only' },
  { value: 'show', label: 'Show notifications too' },
  { value: 'nothing', label: 'Nothing' },
]

function isFocusedBehavior(value: string): value is DesktopNotificationFocusedBehavior {
  return FOCUSED_OPTIONS.some((option) => option.value === value)
}

function useNotificationSettings() {
  const value = usePreferencesStore((state) => state.settings.desktopNotifications)
  const save = usePreferencesStore((state) => state.setDesktopNotifications)
  const [saving, setSaving] = useState(false)
  const update = (next: DesktopNotificationSettings) => {
    if (saving) return
    setSaving(true)
    void save(next)
      .catch((error: unknown) =>
        logger.warn('Could not save notification settings', { error: describe(error) }),
      )
      .finally(() => setSaving(false))
  }
  return { value, update, saving }
}

/** Settings → Notifications: Desktop notifications, their sounds and the badge (ADR 0062). */
export function NotificationsSection() {
  const { value: settings, update, saving } = useNotificationSettings()
  const off = !settings.enabled
  return (
    <SettingsSectionContainer className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">Notifications</h3>
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <Row
            label="Desktop notifications"
            description="Hear about Sessions that need you or are ready to read, even when OpenWaggle is in the background."
          >
            <ToggleSwitch
              checked={settings.enabled}
              label="Desktop notifications"
              disabled={saving}
              onCheckedChange={(enabled) => update({ ...settings, enabled })}
            />
          </Row>
        </div>
        <PermissionCard />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">What notifies</h3>
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          {DESKTOP_NOTIFICATION_CATEGORIES.map((category) => (
            <Row
              key={category}
              label={CATEGORY_COPY[category].label}
              description={CATEGORY_COPY[category].description}
            >
              <SoundPicker
                category={category}
                categoryLabel={CATEGORY_COPY[category].label}
                value={settings.sounds[category]}
                disabled={saving || off || !settings.categories[category]}
                onChange={(sound) =>
                  update({ ...settings, sounds: { ...settings.sounds, [category]: sound } })
                }
              />
              <ToggleSwitch
                checked={settings.categories[category]}
                label={CATEGORY_COPY[category].label}
                disabled={saving || off}
                onCheckedChange={(checked) =>
                  update({
                    ...settings,
                    categories: { ...settings.categories, [category]: checked },
                  })
                }
              />
            </Row>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">Presentation</h3>
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <Row
            label="While OpenWaggle is focused"
            description="For a Session other than the one on screen. The one on screen never notifies."
          >
            <Select
              aria-label="While OpenWaggle is focused"
              selectSize="xs"
              value={settings.whileFocused}
              disabled={saving || off}
              onChange={(event) => {
                if (isFocusedBehavior(event.target.value)) {
                  update({ ...settings, whileFocused: event.target.value })
                }
              }}
            >
              {FOCUSED_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Row>
          <Row
            label="Show badge"
            description="Count your notifications on the app icon, for every kind turned on. Windows shows a dot."
          >
            <ToggleSwitch
              checked={settings.showBadge}
              label="Show badge"
              disabled={saving || off}
              onCheckedChange={(showBadge) => update({ ...settings, showBadge })}
            />
          </Row>
          <Row
            label="Show previews"
            description="Include the start of the reply, question or error. Off keeps message text off the lock screen."
          >
            <ToggleSwitch
              checked={settings.showPreviews}
              label="Show previews"
              disabled={saving || off}
              onCheckedChange={(showPreviews) => update({ ...settings, showPreviews })}
            />
          </Row>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <BellOff className="size-4" />
          Muted
        </h3>
        <MutedList settings={settings} onChange={update} />
      </div>
    </SettingsSectionContainer>
  )
}
