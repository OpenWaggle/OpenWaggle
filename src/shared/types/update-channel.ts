export const UPDATE_CHANNELS = ['stable', 'beta', 'alpha'] as const

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = 'stable'

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return typeof value === 'string' && UPDATE_CHANNELS.some((channel) => channel === value)
}

export function updaterFeedChannel(channel: UpdateChannel) {
  return channel === 'stable' ? 'latest' : channel
}
