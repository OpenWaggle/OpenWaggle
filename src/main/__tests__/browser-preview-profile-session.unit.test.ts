import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type { PermissionRequest, Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  browserPreviewPartition,
  browserPreviewSessionForProfile,
  clearBrowserPreviewProfileData,
  isBrowserPreviewPartition,
} from '../browser-preview-profile-session'

function fakeSession() {
  const events = new EventEmitter()
  const browserSession = fromPartial<Session>({
    clearCache: vi.fn(async () => undefined),
    clearStorageData: vi.fn(async () => undefined),
    getUserAgent: vi.fn(() => 'Mozilla Electron/43.2.0 OpenWaggle/0.3.0'),
    on: events.on.bind(events),
    setBluetoothPairingHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setUserAgent: vi.fn(),
  })
  return { browserSession, events }
}

describe('browser preview profile sessions', () => {
  it('preserves the legacy default and separates persistent and ephemeral profiles', () => {
    expect(browserPreviewPartition('default')).toBe('persist:openwaggle-browser-preview')
    expect(browserPreviewPartition('incognito')).toBe('openwaggle-browser-preview-incognito')
    expect(browserPreviewPartition('work')).toMatch(
      /^persist:openwaggle-browser-preview-profile-[a-f0-9]{20}$/,
    )
    expect(browserPreviewPartition('work')).not.toBe(browserPreviewPartition('personal'))
    expect(isBrowserPreviewPartition(browserPreviewPartition('work'))).toBe(true)
    expect(isBrowserPreviewPartition('persist:other-app')).toBe(false)
  })

  it('does not collapse malformed UTF-16 and its replacement character', () => {
    expect(browserPreviewPartition('p\ud800')).not.toBe(browserPreviewPartition('p\ufffd'))
  })

  it('allows only sanitized clipboard writes in both Electron permission paths', () => {
    const { browserSession } = fakeSession()
    const fromPartition = vi.fn(() => browserSession)
    browserPreviewSessionForProfile('work', { fromPartition })

    const request = vi.mocked(browserSession.setPermissionRequestHandler).mock.calls[0]?.[0]
    const check = vi.mocked(browserSession.setPermissionCheckHandler).mock.calls[0]?.[0]
    expect(request).toBeDefined()
    expect(check).toBeDefined()
    const callback = vi.fn()
    const contents = fromPartial<WebContents>({})
    const requestDetails = fromPartial<PermissionRequest>({})
    request?.(contents, 'clipboard-sanitized-write', callback, requestDetails)
    expect(callback).toHaveBeenLastCalledWith(true)
    request?.(contents, 'media', callback, requestDetails)
    expect(callback).toHaveBeenLastCalledWith(false)
    const checkDetails = { isMainFrame: true }
    expect(check?.(contents, 'clipboard-sanitized-write', '', checkDetails)).toBe(true)
    expect(check?.(contents, 'clipboard-read', '', checkDetails)).toBe(false)
    expect(check?.(contents, 'geolocation', '', checkDetails)).toBe(false)
    expect(browserSession.setUserAgent).toHaveBeenCalledWith('Mozilla')
  })

  it('clears only the selected profile partition', async () => {
    const { browserSession } = fakeSession()
    const fromPartition = vi.fn(() => browserSession)

    await clearBrowserPreviewProfileData('work', { fromPartition })

    expect(fromPartition).toHaveBeenCalledExactlyOnceWith(browserPreviewPartition('work'))
    expect(browserSession.clearStorageData).toHaveBeenCalledWith()
    expect(browserSession.clearCache).toHaveBeenCalledOnce()
  })
})
