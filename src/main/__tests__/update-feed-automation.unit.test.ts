import { describe, expect, it, vi } from 'vitest'
import {
  automationUpdateReleaseUrl,
  configureAutomationUpdateFeed,
} from '../update-feed-automation'

describe('automationUpdateReleaseUrl', () => {
  it('reads a loopback release directory under automation', () => {
    expect(
      automationUpdateReleaseUrl({
        OPENWAGGLE_AUTOMATION: '1',
        OPENWAGGLE_AUTOMATION_UPDATE_FEED: 'http://127.0.0.1:8765/next',
      }),
    ).toBe('http://127.0.0.1:8765/next/')
    expect(
      automationUpdateReleaseUrl({
        OPENWAGGLE_AUTOMATION: '1',
        OPENWAGGLE_AUTOMATION_UPDATE_FEED: 'http://localhost:8765/next/',
      }),
    ).toBe('http://localhost:8765/next/')
  })

  it('ignores the variable outside automation', () => {
    expect(
      automationUpdateReleaseUrl({
        OPENWAGGLE_AUTOMATION_UPDATE_FEED: 'http://127.0.0.1:8765/next/',
      }),
    ).toBeNull()
    expect(automationUpdateReleaseUrl({ OPENWAGGLE_AUTOMATION: '1' })).toBeNull()
  })

  it.each([
    'https://127.0.0.1:8765/next/',
    'http://example.com/next/',
    'http://127.0.0.2:8765/next/',
    'http://user:secret@127.0.0.1:8765/next/',
    'http://127.0.0.1:8765/next/?redirect=1',
  ])('refuses %s, which is not a plain loopback HTTP directory', (value) => {
    expect(
      automationUpdateReleaseUrl({
        OPENWAGGLE_AUTOMATION: '1',
        OPENWAGGLE_AUTOMATION_UPDATE_FEED: value,
      }),
    ).toBeNull()
  })
})

describe('configureAutomationUpdateFeed', () => {
  it('points the engine at the directory and selects it as the release', async () => {
    const setFeed = vi.fn()
    await expect(
      configureAutomationUpdateFeed({ setFeed }, 'http://127.0.0.1:8765/next/'),
    ).resolves.toEqual({ type: 'release', tag: 'http://127.0.0.1:8765/next/' })
    expect(setFeed).toHaveBeenCalledWith({ releaseUrl: 'http://127.0.0.1:8765/next/' })
  })
})
