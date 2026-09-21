import { LOCAL_UPDATE_CONTRACT_VERSION } from '@shared/types/local-update'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsService } from '../../services/settings-service'
import { dispatchLocalUpdateCommand } from '../local-update-command'

const update = vi.fn<(patch: Partial<Settings>) => Effect.Effect<void, Error>>()
let current: Settings

const settingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.succeed(current),
  update,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

describe('local update channel command', () => {
  beforeEach(() => {
    current = { ...DEFAULT_SETTINGS, updateChannel: 'beta' }
    update.mockReset().mockImplementation((patch) =>
      Effect.sync(() => {
        current = { ...current, ...patch }
      }),
    )
  })

  it('lets the authenticated local-machine CLI read the saved channel', async () => {
    await expect(
      Effect.runPromise(
        dispatchLocalUpdateCommand({
          caller: { callerId: 'local-user:machine' },
          payload: {
            contract: 'local-update-v1',
            request: {
              contractVersion: LOCAL_UPDATE_CONTRACT_VERSION,
              operation: 'get-channel',
            },
          },
        }).pipe(Effect.provide(settingsLayer)),
      ),
    ).resolves.toEqual({
      contract: 'local-update-v1',
      response: { contractVersion: LOCAL_UPDATE_CONTRACT_VERSION, updateChannel: 'beta' },
    })
  })

  it('durably changes the shared channel for the authenticated local-machine CLI', async () => {
    const result = await Effect.runPromise(
      dispatchLocalUpdateCommand({
        caller: { callerId: 'local-user:machine' },
        payload: {
          contract: 'local-update-v1',
          request: {
            contractVersion: LOCAL_UPDATE_CONTRACT_VERSION,
            operation: 'set-channel',
            channel: 'alpha',
          },
        },
      }).pipe(Effect.provide(settingsLayer)),
    )

    expect(update).toHaveBeenCalledWith({ updateChannel: 'alpha' })
    expect(result.response.updateChannel).toBe('alpha')
  })

  it('denies named profiles access to app-global update settings', async () => {
    const error = await Effect.runPromise(
      dispatchLocalUpdateCommand({
        caller: {
          callerId: 'profile:restricted',
          profileAuthority: {
            profileId: 'profile-1',
            profileName: 'restricted',
            capabilities: [],
            scope: {},
            authorizationCeiling: 'ask-for-approval',
          },
        },
        payload: {
          contract: 'local-update-v1',
          request: {
            contractVersion: LOCAL_UPDATE_CONTRACT_VERSION,
            operation: 'get-channel',
          },
        },
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(settingsLayer)),
    )

    expect(error).toMatchObject({ code: 'capability_denied' })
  })
})
