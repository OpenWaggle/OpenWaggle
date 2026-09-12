import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternal = vi.hoisted(() => vi.fn())

vi.mock('../../desktop-ui', () => ({ openExternal }))

import {
  browserImportFullDiskAccessSettingsUrl,
  openBrowserImportFullDiskAccessSettings,
} from '../browser-import-system-settings'

describe('browser import operating-system settings', () => {
  beforeEach(() => {
    openExternal.mockReset()
    openExternal.mockResolvedValue(undefined)
  })

  it('opens only the fixed macOS Full Disk Access destination', async () => {
    await expect(openBrowserImportFullDiskAccessSettings('darwin')).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
    )
    expect(browserImportFullDiskAccessSettingsUrl('darwin')).toContain('Privacy_AllFiles')
  })

  it('does not launch an external destination on other platforms', async () => {
    await expect(openBrowserImportFullDiskAccessSettings('linux')).resolves.toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('propagates the desktop automation guard instead of claiming settings opened', async () => {
    openExternal.mockRejectedValueOnce(new Error('blocked by automation'))

    await expect(openBrowserImportFullDiskAccessSettings('darwin')).rejects.toThrow(
      'blocked by automation',
    )
  })
})
