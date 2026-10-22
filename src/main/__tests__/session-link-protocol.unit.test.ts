import { describe, expect, it, vi } from 'vitest'
import {
  claimsSessionLinksFromOperatingSystem,
  forwardSessionLinksToDesktopApp,
  installSessionLinkProtocol,
  type SessionLinkProtocolHost,
} from '../session-link-protocol'

type OpenUrlListener = Parameters<SessionLinkProtocolHost['on']>[1]

function fakeHost(isPackaged = true) {
  const listeners: OpenUrlListener[] = []
  const setAsDefaultProtocolClient = vi.fn(() => true)
  const host: SessionLinkProtocolHost = {
    isPackaged,
    on: (_event, listener) => {
      listeners.push(listener)
    },
    setAsDefaultProtocolClient,
  }
  return { host, listeners, setAsDefaultProtocolClient }
}

describe('claimsSessionLinksFromOperatingSystem', () => {
  it('claims links only in a packaged release build outside automation', () => {
    const release = { isPackaged: true, automation: false } as const
    expect(claimsSessionLinksFromOperatingSystem({ ...release, channel: 'stable' })).toBe(true)
    expect(claimsSessionLinksFromOperatingSystem({ ...release, channel: 'alpha' })).toBe(true)
    expect(claimsSessionLinksFromOperatingSystem({ ...release, channel: 'dev' })).toBe(false)
    expect(
      claimsSessionLinksFromOperatingSystem({ ...release, channel: 'stable', isPackaged: false }),
    ).toBe(false)
    expect(
      claimsSessionLinksFromOperatingSystem({ ...release, channel: 'stable', automation: true }),
    ).toBe(false)
  })
})

describe('installSessionLinkProtocol', () => {
  it('opens links macOS delivers and keeps them from the default handling', () => {
    const { host, listeners, setAsDefaultProtocolClient } = fakeHost()
    const openLink = vi.fn()

    installSessionLinkProtocol({
      host,
      automation: false,
      openLink,
      platform: 'darwin',
      channel: 'stable',
    })
    const preventDefault = vi.fn()
    for (const listener of listeners) listener({ preventDefault }, 'openwaggle://sessions/s-1')

    expect(preventDefault).toHaveBeenCalled()
    expect(openLink).toHaveBeenCalledWith('openwaggle://sessions/s-1')
    // The packaged macOS bundle declares the scheme; nothing is registered at runtime.
    expect(setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })

  it('registers the scheme at runtime on Windows only for a build that claims links', () => {
    const release = fakeHost()
    installSessionLinkProtocol({
      host: release.host,
      automation: false,
      openLink: vi.fn(),
      platform: 'win32',
      channel: 'beta',
    })
    expect(release.setAsDefaultProtocolClient).toHaveBeenCalledWith('openwaggle')
    expect(release.listeners).toEqual([])

    for (const input of [
      { host: fakeHost().host, channel: 'dev', automation: false },
      { host: fakeHost(false).host, channel: 'stable', automation: false },
      { host: fakeHost().host, channel: 'stable', automation: true },
    ] as const) {
      installSessionLinkProtocol({ ...input, openLink: vi.fn(), platform: 'win32' })
      expect(input.host.setAsDefaultProtocolClient).not.toHaveBeenCalled()
    }
  })

  it('keeps running when Windows refuses the registration', () => {
    const { host, setAsDefaultProtocolClient } = fakeHost()
    setAsDefaultProtocolClient.mockReturnValue(false)

    expect(() =>
      installSessionLinkProtocol({
        host,
        automation: false,
        openLink: vi.fn(),
        platform: 'win32',
        channel: 'stable',
      }),
    ).not.toThrow()
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith('openwaggle')
  })

  it('registers nothing at runtime on Linux, whose installed desktop entry declares the scheme', () => {
    const { host, listeners, setAsDefaultProtocolClient } = fakeHost()
    installSessionLinkProtocol({
      host,
      automation: false,
      openLink: vi.fn(),
      platform: 'linux',
      channel: 'stable',
    })
    expect(setAsDefaultProtocolClient).not.toHaveBeenCalled()
    expect(listeners).toEqual([])
  })
})

describe('forwardSessionLinksToDesktopApp', () => {
  it('hands a Session link macOS delivered to a background process to the desktop app', () => {
    const { host, listeners } = fakeHost()
    const launchDesktopApp = vi.fn()
    forwardSessionLinksToDesktopApp({
      host,
      automation: false,
      launchDesktopApp,
      platform: 'darwin',
      channel: 'stable',
    })

    const preventDefault = vi.fn()
    for (const listener of listeners) {
      listener({ preventDefault }, 'openwaggle://sessions/s-1')
      listener({ preventDefault }, 'openwaggle://app/index.html')
    }

    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(launchDesktopApp).toHaveBeenCalledExactlyOnceWith('openwaggle://sessions/s-1')
  })

  it('listens only in a macOS release build that claims links', () => {
    for (const input of [
      { host: fakeHost().host, platform: 'win32', channel: 'stable' },
      { host: fakeHost().host, platform: 'darwin', channel: 'dev' },
      { host: fakeHost(false).host, platform: 'darwin', channel: 'stable' },
    ] as const) {
      const on = vi.spyOn(input.host, 'on')
      forwardSessionLinksToDesktopApp({ ...input, automation: false, launchDesktopApp: vi.fn() })
      expect(on).not.toHaveBeenCalled()
    }
  })
})
