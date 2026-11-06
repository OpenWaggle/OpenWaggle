import * as SqlClient from '@effect/sql/SqlClient'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type WakeHandler = (request: { readonly parentSessionId: string }) => void
type ResolveAuthority = (candidate: unknown) => Effect.Effect<{ readonly blocked?: string }>

const mocks = vi.hoisted(() => {
  const state: {
    draining: boolean
    /** Whether the Host starts draining once the wake read its candidate. */
    drainAfterCandidate: boolean
    handler: WakeHandler | undefined
    authority: { readonly blocked?: string } | undefined
  } = { draining: false, drainAfterCandidate: false, handler: undefined, authority: undefined }
  return { state, wakeIdleParent: vi.fn(), resolveHiveWakeAuthority: vi.fn() }
})

vi.mock('../session-host-events', () => ({
  tryGetSessionHostEventRuntime: () => ({ liveness: { isDraining: () => mocks.state.draining } }),
}))
vi.mock('../hive-parent-wake-authority', () => ({
  resolveHiveWakeAuthority: () => {
    mocks.resolveHiveWakeAuthority()
    return Effect.succeed({})
  },
}))
vi.mock('../../application/hive-parent-wake', () => ({
  wakeIdleParent: (request: unknown, resolveAuthority: ResolveAuthority) => {
    mocks.wakeIdleParent(request)
    if (mocks.state.drainAfterCandidate) mocks.state.draining = true
    return resolveAuthority({ parentSessionId: 'queen' }).pipe(
      Effect.tap((authority) => Effect.sync(() => (mocks.state.authority = authority))),
      Effect.map((authority) => (authority.blocked === undefined ? 'started' : 'refused')),
    )
  },
}))
vi.mock('../../application/hive-parent-wake-request', () => ({
  installHiveParentWakeHandler: (handler: WakeHandler) => {
    mocks.state.handler = handler
    return () => {}
  },
}))
vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { installHiveParentWake } from '../hive-parent-wake-installer'

// The wake and its authority are mocked, so the SQL client the installer captures is unused.
function install() {
  return Effect.runPromise(
    Effect.scoped(
      fromAny<Effect.Effect<void, never, SqlClient.SqlClient>, typeof installHiveParentWake>(
        installHiveParentWake,
      ).pipe(Effect.provideService(SqlClient.SqlClient, fromPartial<SqlClient.SqlClient>({}))),
    ),
  )
}

describe('installHiveParentWake', () => {
  beforeEach(() => {
    mocks.state.draining = false
    mocks.state.drainAfterCandidate = false
    mocks.state.handler = undefined
    mocks.state.authority = undefined
    mocks.wakeIdleParent.mockReset()
    mocks.resolveHiveWakeAuthority.mockReset()
  })

  it('starts a wake while the Session Host is running', async () => {
    await install()
    mocks.state.handler?.({ parentSessionId: 'queen' })
    await vi.waitFor(() => expect(mocks.state.authority).toEqual({}))
    expect(mocks.resolveHiveWakeAuthority).toHaveBeenCalledTimes(1)
  })

  // A draining Host starts no Run, so the stops of its drain cannot wake a parent.
  it('starts no wake while the Session Host is shutting down', async () => {
    mocks.state.draining = true
    await install()
    mocks.state.handler?.({ parentSessionId: 'queen' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.wakeIdleParent).not.toHaveBeenCalled()

    // The refused wake freed the parent's slot, so a later request still runs.
    mocks.state.draining = false
    mocks.state.handler?.({ parentSessionId: 'queen' })
    await vi.waitFor(() => expect(mocks.wakeIdleParent).toHaveBeenCalledTimes(1))
  })

  it('refuses a wake when the Session Host starts shutting down before its start', async () => {
    mocks.state.drainAfterCandidate = true
    await install()
    mocks.state.handler?.({ parentSessionId: 'queen' })
    await vi.waitFor(() => expect(mocks.state.authority?.blocked).toBeDefined())
    expect(mocks.resolveHiveWakeAuthority).not.toHaveBeenCalled()
  })
})
