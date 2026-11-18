import {
  type DesktopNotificationCategory,
  isBundledNotificationSound,
  NOTIFICATION_SOUND_IDS,
  type NotificationSoundId,
} from '@shared/types/desktop-notification'
import { Play } from 'lucide-react'
import { NOTIFICATION_SOUND_LABELS, playNotificationSound } from '@/features/desktop-notifications'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { describe } from './NotificationPermissionCard'

const logger = createRendererLogger('settings/notifications')

function isSoundId(value: string): value is NotificationSoundId {
  return NOTIFICATION_SOUND_IDS.some((sound) => sound === value)
}

/** A category's Notification sound, with a preview of the bundled ones. */
export function SoundPicker({
  categoryLabel,
  value,
  disabled,
  onChange,
}: {
  readonly category: DesktopNotificationCategory
  readonly categoryLabel: string
  readonly value: NotificationSoundId
  readonly disabled: boolean
  readonly onChange: (sound: NotificationSoundId) => void
}) {
  const label = `${categoryLabel} sound`
  return (
    <>
      <Select
        aria-label={label}
        selectSize="xs"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (isSoundId(event.target.value)) onChange(event.target.value)
        }}
      >
        {NOTIFICATION_SOUND_IDS.map((sound) => (
          <option key={sound} value={sound}>
            {NOTIFICATION_SOUND_LABELS[sound]}
          </option>
        ))}
      </Select>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Preview ${label}`}
        title="Preview"
        disabled={!isBundledNotificationSound(value)}
        onClick={() => {
          if (!isBundledNotificationSound(value)) return
          void playNotificationSound(value).catch((error: unknown) =>
            logger.warn('Could not preview a sound', { error: describe(error) }),
          )
        }}
      >
        <Play className="size-3" />
      </Button>
    </>
  )
}
