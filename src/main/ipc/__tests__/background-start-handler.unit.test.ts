import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  typedHandle: vi.fn(),
  readBackgroundStart: vi.fn(),
  writeBackgroundStart: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: mocks.typedHandle }))
vi.mock('../../background-start', () => ({
  readBackgroundStart: mocks.readBackgroundStart,
  writeBackgroundStart: mocks.writeBackgroundStart,
}))

import { registerBackgroundStartHandlers } from '../background-start-handler'

function setBackgroundStart(enabled: unknown) {
  const handler = mocks.typedHandle.mock.calls.find(
    ([channel]) => channel === 'app:set-background-start',
  )?.[1]
  if (typeof handler !== 'function') throw new Error('Expected the set handler')
  return Effect.runPromise(handler({}, enabled))
}

describe('background start handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writeBackgroundStart.mockResolvedValue({ supported: true, enabled: true })
    registerBackgroundStartHandlers()
  })

  it('turns background start on or off with the boolean the renderer sent', async () => {
    await expect(setBackgroundStart(true)).resolves.toEqual({ supported: true, enabled: true })
    await setBackgroundStart(false)

    expect(mocks.writeBackgroundStart.mock.calls).toEqual([[true], [false]])
  })

  it.each(['false', 1, null, undefined])(
    'refuses %j instead of reading it as a truthy or falsy value',
    async (enabled) => {
      await expect(setBackgroundStart(enabled)).rejects.toThrow()
      expect(mocks.writeBackgroundStart).not.toHaveBeenCalled()
    },
  )
})
