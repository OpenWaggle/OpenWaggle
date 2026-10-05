import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startLocalSessionHost: vi.fn<(input: unknown) => Promise<unknown>>(async () => ({})),
  interruptAllSessionRuns: Symbol('interruptAllSessionRuns effect'),
}))

vi.mock('../local-session-host-runtime', () => ({
  startLocalSessionHost: (input: unknown) => mocks.startLocalSessionHost(input),
}))
vi.mock('../local-user-credential', () => ({
  ensureLocalUserCredential: async () => 'local-user-credential',
}))
vi.mock('../../application/session-run-interruption', () => ({
  interruptAllSessionRuns: () => mocks.interruptAllSessionRuns,
}))

import type { LocalSessionHostPaths } from '../local-session-paths'
import { startAppSessionHost } from '../session-host-bootstrap'

const paths: LocalSessionHostPaths = {
  stateRoot: '/tmp/openwaggle-test',
  legacyDatabasePath: '/tmp/openwaggle-test/legacy.sqlite',
  databasePath: '/tmp/openwaggle-test/session-host.sqlite',
  recoveryDatabasePath: '/tmp/openwaggle-test/recovery.sqlite',
  credentialPath: '/tmp/openwaggle-test/local-user.credential',
  endpoint: '/tmp/openwaggle-test/host.sock',
  endpointDirectory: '/tmp/openwaggle-test',
  endpointCapabilityPath: null,
}

describe('Session Host bootstrap', () => {
  it('interrupts every Run through the app runtime when a drain reaches its deadline', async () => {
    const ranEffects: unknown[] = []
    const runEffect = async <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> => {
      ranEffects.push(effect)
      // The first effect reads the settings; nothing else needs a value here.
      return fromAny<A, unknown>(ranEffects.length === 1 ? DEFAULT_SETTINGS : undefined)
    }

    await startAppSessionHost({
      paths,
      runEffect,
      startOwnedServices: async () => undefined,
      stopOwnedServices: async () => undefined,
    })
    const input = mocks.startLocalSessionHost.mock.calls[0]?.[0]
    const interrupt = Reflect.get(Object(input), 'interruptRunsAtDrainDeadline')
    expect(interrupt).toBeTypeOf('function')
    await Reflect.apply(interrupt, undefined, [])

    expect(ranEffects.at(-1)).toBe(mocks.interruptAllSessionRuns)
    expect(Effect.isEffect(ranEffects[0])).toBe(true)
  })
})
