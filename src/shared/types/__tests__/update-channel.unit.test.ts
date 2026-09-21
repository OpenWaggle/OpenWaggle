import { describe, expect, it } from 'vitest'
import { defaultUpdateChannelForBuild, updaterFeedChannel } from '../update-channel'

describe('update channels', () => {
  it.each([
    ['alpha', 'alpha'],
    ['beta', 'beta'],
    ['stable', 'stable'],
    ['rc', 'stable'],
    ['dev', 'stable'],
  ] as const)('defaults a %s build to the %s preference', (buildChannel, expected) => {
    expect(defaultUpdateChannelForBuild(buildChannel)).toBe(expected)
  })

  it.each([
    ['stable', 'latest'],
    ['beta', 'beta'],
    ['alpha', 'alpha'],
  ] as const)('maps %s to the %s updater feed', (channel, expected) => {
    expect(updaterFeedChannel(channel)).toBe(expected)
  })
})
