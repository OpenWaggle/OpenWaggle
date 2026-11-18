import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsServiceShape } from '../../services/settings-service'

const mocks = vi.hoisted(() => ({ invokeConfiguredHostUi: vi.fn() }))

vi.mock('../gui-session-command-router', () => ({
  invokeConfiguredHostUi: mocks.invokeConfiguredHostUi,
}))

const { makeSourceControlSettingsAccess } = await import('../source-control-settings-access')

function localSettings() {
  let stored: Settings = { ...DEFAULT_SETTINGS }
  const service = fromPartial<SettingsServiceShape>({
    get: () => Effect.sync(() => stored),
    update: (partial: Partial<Settings>) =>
      Effect.sync(() => {
        stored = { ...stored, ...partial }
      }),
  })
  return { service, current: () => stored }
}

describe('source-control Settings from either process', () => {
  beforeEach(() => {
    mocks.invokeConfiguredHostUi.mockReset()
  })

  it('reads and patches the Session Host’s Settings from an attached window', async () => {
    const local = localSettings()
    mocks.invokeConfiguredHostUi.mockImplementation(async (channel: string) =>
      channel === 'settings:get'
        ? {
            handled: true,
            result: {
              ...DEFAULT_SETTINGS,
              sourceControlHostProviders: { 'git.acme.io': 'gitlab' },
            },
          }
        : { handled: true, result: { ok: true } },
    )
    const access = makeSourceControlSettingsAccess(local.service)

    await expect(access.read()).resolves.toMatchObject({
      sourceControlHostProviders: { 'git.acme.io': 'gitlab' },
    })
    await access.patch({ sourceControlRepositoryAccounts: { 'git.acme.io/a/b': 'jdoe' } })

    expect(mocks.invokeConfiguredHostUi).toHaveBeenLastCalledWith('source-control:patch-settings', [
      { sourceControlRepositoryAccounts: { 'git.acme.io/a/b': 'jdoe' } },
    ])
    // The window's own isolated database is never written.
    expect(local.current().sourceControlRepositoryAccounts).toEqual({})
  })

  it('surfaces a patch the Host refused', async () => {
    mocks.invokeConfiguredHostUi.mockResolvedValue({
      handled: true,
      result: { ok: false, error: 'Settings are read-only' },
    })
    const access = makeSourceControlSettingsAccess(localSettings().service)

    await expect(access.patch({ changeRequestOpenDestination: 'website' })).rejects.toThrow(
      'Settings are read-only',
    )
  })

  it('uses its own Settings in the process that owns them', async () => {
    mocks.invokeConfiguredHostUi.mockResolvedValue({ handled: false })
    const local = localSettings()
    const access = makeSourceControlSettingsAccess(local.service)

    await Promise.all([
      access.patch({ sourceControlDetectedHostProviders: { 'a.io': 'github' } }),
      access.patch({ sourceControlDetectedHostProviders: { 'b.io': 'gitlab' } }),
    ])

    expect(local.current().sourceControlDetectedHostProviders).toEqual({
      'a.io': 'github',
      'b.io': 'gitlab',
    })
  })
})
