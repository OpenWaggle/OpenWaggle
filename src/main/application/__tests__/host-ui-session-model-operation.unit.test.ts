import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionThinkingLevelChange } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishSessionHostEventMock } = vi.hoisted(() => ({
  publishSessionHostEventMock: vi.fn(),
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
}))

import { SessionSettingsRepository } from '../../ports/session-settings-repository'
import { ThinkingLevelDefaultService } from '../../ports/thinking-level-default-service'
import { dispatchHostBackedSessionGuiOperation } from '../host-ui-session-operation-dispatcher'

const SESSION_ID = SessionId('session-model')
const NEXT_MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')
const CHANGED: SessionThinkingLevelChange = { changed: true }
const RUN_ACTIVE: SessionThinkingLevelChange = { changed: false, code: 'session_run_active' }

function services(change: SessionThinkingLevelChange = CHANGED) {
  const setModel = vi.fn(() => Effect.succeed(change))
  const setThinkingLevel = vi.fn(() => Effect.succeed(change))
  let defaultLevel: ThinkingLevel = 'medium'
  const setDefault = vi.fn((level: ThinkingLevel) =>
    Effect.sync(() => {
      defaultLevel = level
    }),
  )
  const getDefault = vi.fn(() => Effect.sync(() => defaultLevel))
  return {
    setModel,
    setThinkingLevel,
    setDefault,
    getDefault,
    provide: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(
          SessionSettingsRepository,
          SessionSettingsRepository.of({
            setModel,
            setThinkingLevel,
            applyRunStartThinkingLevel: () => Effect.succeed(true),
          }),
        ),
        Effect.provideService(
          ThinkingLevelDefaultService,
          ThinkingLevelDefaultService.of({ getDefault, setDefault }),
        ),
      ),
  }
}

function run<A>(
  channel:
    | 'sessions:set-model'
    | 'sessions:set-thinking-level'
    | 'sessions:get-default-thinking-level'
    | 'sessions:set-default-thinking-level',
  args: readonly unknown[],
  fixture: ReturnType<typeof services>,
) {
  const effect = fixture.provide(dispatchHostBackedSessionGuiOperation(channel, fromAny(args)))
  return Effect.runPromise(fromAny<Effect.Effect<A, unknown, never>, typeof effect>(effect))
}

describe('sessions:set-model', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockReset()
  })

  it('switches the durable Session model and tells attached clients the Session changed', async () => {
    const fixture = services()

    await expect(run('sessions:set-model', [SESSION_ID, NEXT_MODEL], fixture)).resolves.toBe(
      undefined,
    )
    expect(fixture.setModel).toHaveBeenCalledWith(SESSION_ID, NEXT_MODEL)
    expect(publishSessionHostEventMock).toHaveBeenCalledWith({
      kind: 'session-list-changed',
      sessionId: SESSION_ID,
      change: 'updated',
    })
  })

  it('refuses the change while the Session has an active Run', async () => {
    const fixture = services(RUN_ACTIVE)

    await expect(run('sessions:set-model', [SESSION_ID, NEXT_MODEL], fixture)).rejects.toThrow(
      'session_run_active',
    )
    expect(publishSessionHostEventMock).not.toHaveBeenCalled()
  })

  it('rejects a model that is not a canonical provider/model reference', async () => {
    const fixture = services()

    await expect(
      run('sessions:set-model', [SESSION_ID, 'not-a-model-ref'], fixture),
    ).rejects.toThrow('canonical provider/model reference')
    expect(fixture.setModel).not.toHaveBeenCalled()
  })

  it('rejects a missing model instead of clearing the Session model', async () => {
    const fixture = services()

    await expect(run('sessions:set-model', [SESSION_ID, undefined], fixture)).rejects.toThrow(
      'Session model is required.',
    )
    expect(fixture.setModel).not.toHaveBeenCalled()
  })

  it('surfaces a Session without an execution profile and publishes nothing', async () => {
    const fixture = services({ changed: false, code: 'session_profile_not_found' })

    await expect(run('sessions:set-model', [SESSION_ID, NEXT_MODEL], fixture)).rejects.toThrow(
      'no execution profile',
    )
    expect(publishSessionHostEventMock).not.toHaveBeenCalled()
  })
})

describe('sessions:set-thinking-level', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockReset()
  })

  it("sets the Session's level and makes the desktop user's pick Pi's global default", async () => {
    const fixture = services()

    await expect(
      run('sessions:set-thinking-level', [SESSION_ID, 'high'], fixture),
    ).resolves.toEqual(CHANGED)
    expect(fixture.setThinkingLevel).toHaveBeenCalledWith(SESSION_ID, 'high')
    expect(fixture.setDefault).toHaveBeenCalledWith('high')
    await expect(run('sessions:get-default-thinking-level', [], fixture)).resolves.toBe('high')
    expect(publishSessionHostEventMock).toHaveBeenCalledWith({
      kind: 'session-list-changed',
      sessionId: SESSION_ID,
      change: 'updated',
    })
  })

  it('refuses the change while a Run is active, leaving the global default alone', async () => {
    const fixture = services(RUN_ACTIVE)

    await expect(
      run('sessions:set-thinking-level', [SESSION_ID, 'high'], fixture),
    ).resolves.toEqual(RUN_ACTIVE)
    expect(fixture.setDefault).not.toHaveBeenCalled()
    expect(publishSessionHostEventMock).not.toHaveBeenCalled()
  })

  it('rejects a level Pi does not define', async () => {
    const fixture = services()

    await expect(
      run('sessions:set-thinking-level', [SESSION_ID, 'ultra'], fixture),
    ).rejects.toThrow('Thinking level must be one of')
    expect(fixture.setThinkingLevel).not.toHaveBeenCalled()
  })
})

describe("Pi's default thinking level", () => {
  it('reads it for a project and sets it for a Session that does not exist yet', async () => {
    const fixture = services()

    await expect(run('sessions:get-default-thinking-level', ['/project'], fixture)).resolves.toBe(
      'medium',
    )
    expect(fixture.getDefault).toHaveBeenCalledWith('/project')
    await run('sessions:set-default-thinking-level', ['low'], fixture)
    expect(fixture.setDefault).toHaveBeenCalledWith('low')
    expect(fixture.setThinkingLevel).not.toHaveBeenCalled()
  })
})
