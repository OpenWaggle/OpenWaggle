import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type WakeHandler = (request: { readonly parentSessionId: string }) => void

const mocks = vi.hoisted(() => {
  const state: { draining: boolean; handler: WakeHandler | undefined } = {
    draining: false,
    handler: undefined,
  }
  return { state, wakeIdleParent: vi.fn() }
})

vi.mock('../session-host-events', () => ({
  tryGetSessionHostEventRuntime: () => ({ liveness: { isDraining: () => mocks.state.draining } }),
}))
vi.mock('../../application/hive-parent-wake', () => ({
  wakeIdleParent: (...args: unknown[]) => {
    mocks.wakeIdleParent(...args)
    return Effect.succeed('woken')
  },
}))
vi.mock('../../application/hive-parent-wake-request', () => ({
  installHiveParentWakeHandler: (
    handler: (request: { readonly parentSessionId: string }) => void,
  ) => {
    mocks.state.handler = handler
    return () => {}
  },
}))
vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { installHiveParentWake } from '../hive-parent-wake-installer'

// The wake is mocked, so the services the installer captures are never used.
function install() {
  return Effect.runPromise(
    Effect.scoped(
      fromAny<Effect.Effect<void>, typeof installHiveParentWake>(installHiveParentWake),
    ),
  )
}

describe('installHiveParentWake', () => {
  beforeEach(() => {
    mocks.state.draining = false
    mocks.wakeIdleParent.mockReset()
    mocks.state.handler = undefined
  })

  it('starts a wake while the Session Host is running', async () => {
    await install()
    mocks.state.handler?.({ parentSessionId: 'queen' })
    await vi.waitFor(() => expect(mocks.wakeIdleParent).toHaveBeenCalledTimes(1))
  })

  // A draining Host starts no Run, so the stops of its drain cannot wake a parent.
  it('starts no wake while the Session Host is shutting down', async () => {
    mocks.state.draining = true
    await install()
    mocks.state.handler?.({ parentSessionId: 'queen' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.wakeIdleParent).not.toHaveBeenCalled()
  })
})
