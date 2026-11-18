import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsServiceShape } from '../../services/settings-service'

const { invokeConfiguredHostUiMock } = vi.hoisted(() => ({
  invokeConfiguredHostUiMock: vi.fn(),
}))

vi.mock('../gui-session-command-router', () => ({
  invokeConfiguredHostUi: invokeConfiguredHostUiMock,
}))

import { getGuiBrowserProfiles, updateGuiBrowserProfiles } from '../gui-browser-profile-settings'

const profiles = [{ id: 'imported', name: 'Imported', kind: 'persistent' as const }]
const get = vi.fn(() => Effect.succeed(DEFAULT_SETTINGS))
const update = vi.fn(() => Effect.void)
const settings = fromPartial<SettingsServiceShape>({ get, update })

describe('GUI browser profile settings authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeConfiguredHostUiMock.mockReset()
  })

  it('reads configured profiles from the authoritative Host without consulting isolated settings', async () => {
    invokeConfiguredHostUiMock.mockResolvedValue({
      handled: true,
      result: { browserProfiles: profiles },
    })
    await expect(getGuiBrowserProfiles(settings)).resolves.toEqual(profiles)
    expect(invokeConfiguredHostUiMock).toHaveBeenCalledWith('settings:get', [])
    expect(get).not.toHaveBeenCalled()
  })

  it('requires a valid Host profile response instead of falling back to GUI defaults', async () => {
    invokeConfiguredHostUiMock.mockResolvedValue({ handled: true, result: {} })
    await expect(getGuiBrowserProfiles(settings)).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })

  it('awaits Host durable acknowledgment without writing the GUI database', async () => {
    let acknowledge: ((value: unknown) => void) | undefined
    invokeConfiguredHostUiMock.mockReturnValue(
      new Promise((resolve) => {
        acknowledge = resolve
      }),
    )
    let settled = false
    const pending = updateGuiBrowserProfiles(settings, profiles).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(invokeConfiguredHostUiMock).toHaveBeenCalledWith('settings:update', [
      { browserProfiles: profiles },
    ])
    acknowledge?.({ handled: true, result: { ok: true } })
    await pending
    expect(settled).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })

  it.each([[{ ok: false, error: 'Host database unavailable' }], [{}]])(
    'does not report a profile committed for a rejected or malformed Host result',
    async (result) => {
      invokeConfiguredHostUiMock.mockResolvedValue({ handled: true, result })
      await expect(updateGuiBrowserProfiles(settings, profiles)).rejects.toThrow()
      expect(update).not.toHaveBeenCalled()
    },
  )

  it('does not retry an ambiguous transport failure through a local writer', async () => {
    invokeConfiguredHostUiMock.mockRejectedValue(new Error('Host disconnected'))
    await expect(updateGuiBrowserProfiles(settings, profiles)).rejects.toThrow('Host disconnected')
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps the in-process settings path when no remote Host route is configured', async () => {
    invokeConfiguredHostUiMock.mockResolvedValue({ handled: false })
    await expect(getGuiBrowserProfiles(settings)).resolves.toEqual(DEFAULT_SETTINGS.browserProfiles)
    await updateGuiBrowserProfiles(settings, profiles)
    expect(get).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith({ browserProfiles: profiles })
  })
})
