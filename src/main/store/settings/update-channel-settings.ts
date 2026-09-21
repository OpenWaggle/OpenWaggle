import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { isUpdateChannel } from '@shared/types/update-channel'

export function resolveUpdateChannel(raw: unknown) {
  return isUpdateChannel(raw) ? raw : DEFAULT_SETTINGS.updateChannel
}
