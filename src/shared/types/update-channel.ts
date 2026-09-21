import type { BuildChannel } from './build-identity'

export const UPDATE_CHANNELS = ['stable', 'beta', 'alpha'] as const

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = 'stable'

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return typeof value === 'string' && UPDATE_CHANNELS.some((channel) => channel === value)
}

export function updaterFeedChannel(channel: UpdateChannel) {
  return channel === 'stable' ? 'latest' : channel
}

/**
 * Preserve the release stream that installed a prerelease build when the user
 * has not made an explicit choice yet. RC builds intentionally move to Stable:
 * RC is exact-install only and is not an automatic update channel.
 */
export function defaultUpdateChannelForBuild(buildChannel: BuildChannel): UpdateChannel {
  if (buildChannel === 'alpha' || buildChannel === 'beta') return buildChannel
  return DEFAULT_UPDATE_CHANNEL
}
