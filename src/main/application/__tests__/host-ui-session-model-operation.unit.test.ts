import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcInvokeArgs } from '@shared/types/ipc'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishSessionHostEventMock } = vi.hoisted(() => ({
  publishSessionHostEventMock: vi.fn(),
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
}))

import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { dispatchHostBackedSessionGuiOperation } from '../host-ui-session-operation-dispatcher'

const SESSION_ID = SessionId('session-model')
const NEXT_MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')

function run(args: readonly unknown[], switched = true) {
  const setExecutionModel = vi.fn(() => Effect.succeed(switched))
  const repository = SessionProjectionRepository.of(fromPartial({ setExecutionModel }))
  const effect = dispatchHostBackedSessionGuiOperation(
    'sessions:set-model',
    fromAny<IpcInvokeArgs<'sessions:set-model'>, readonly unknown[]>(args),
  ).pipe(Effect.provideService(SessionProjectionRepository, repository))
  return {
    setExecutionModel,
    result: Effect.runPromise(
      fromAny<Effect.Effect<undefined, unknown, never>, typeof effect>(effect),
    ),
  }
}

describe('sessions:set-model', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockReset()
  })

  it('switches the durable Session model and tells attached clients the Session changed', async () => {
    const { setExecutionModel, result } = run([SESSION_ID, NEXT_MODEL])

    await expect(result).resolves.toBeUndefined()
    expect(setExecutionModel).toHaveBeenCalledWith(SESSION_ID, NEXT_MODEL)
    expect(publishSessionHostEventMock).toHaveBeenCalledWith({
      kind: 'session-list-changed',
      sessionId: SESSION_ID,
      change: 'updated',
    })
  })

  it('rejects a model that is not a canonical provider/model reference', async () => {
    const { setExecutionModel, result } = run([SESSION_ID, 'not-a-model-ref'])

    await expect(result).rejects.toThrow('canonical provider/model reference')
    expect(setExecutionModel).not.toHaveBeenCalled()
  })

  it('rejects a missing model instead of clearing the Session model', async () => {
    const { setExecutionModel, result } = run([SESSION_ID, undefined])

    await expect(result).rejects.toThrow('Session model is required.')
    expect(setExecutionModel).not.toHaveBeenCalled()
  })

  it('surfaces a Session without an execution profile and publishes nothing', async () => {
    const { result } = run([SESSION_ID, NEXT_MODEL], false)

    await expect(result).rejects.toThrow('no execution profile')
    expect(publishSessionHostEventMock).not.toHaveBeenCalled()
  })
})
