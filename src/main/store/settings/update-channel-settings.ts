import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { defaultUpdateChannelForBuild, isUpdateChannel } from '@shared/types/update-channel'

export function resolveUpdateChannel(raw: unknown) {
  if (isUpdateChannel(raw)) return raw
  return defaultUpdateChannelForBuild(BUILD_CHANNEL)
}
