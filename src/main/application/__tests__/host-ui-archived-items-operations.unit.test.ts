import {
  type ArchivedItemRef,
  archivedItemKey,
  SESSION_NOT_ARCHIVED_MESSAGE,
} from '@shared/types/archived-items'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { emptySessionCatalogMethods } from './session-repository-test-support'

interface DispatchedCommand {
  readonly payload: {
    readonly contract: string
    readonly request: { readonly command: Record<string, unknown> }
  }
}

const { dispatchLocalSessionCommandMock } = vi.hoisted(() => ({
  dispatchLocalSessionCommandMock: vi.fn<(input: DispatchedCommand) => unknown>(),
}))

vi.mock('../local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  emitRunCompleted: vi.fn(),
}))

import { deleteArchivedSessions, setArchivedItems } from '../host-ui-archived-items-operations'

const sessionRef = { kind: 'session', sessionId: SessionId('session-1') } as const
const branchRef = {
  kind: 'branch',
  sessionId: SessionId('session-2'),
  branchId: SessionBranchId('session-2:branch:b'),
} as const

/** Archive time per item key; null is not archived, a missing key does not exist. */
let states = new Map<string, number | null>()
const setArchiveTimes = vi.fn<SessionRepositoryShape['setArchiveTimes']>(() => Effect.void)

function repository(overrides: Partial<SessionRepositoryShape> = {}) {
  const methods = {
    ...emptySessionCatalogMethods,
    readArchivedItemStates: (refs: readonly ArchivedItemRef[]) =>
      Effect.succeed(
        new Map(
          refs.flatMap((ref) => {
            const state = states.get(archivedItemKey(ref))
            return state === undefined ? [] : [[archivedItemKey(ref), state] as const]
          }),
        ),
      ),
    setArchiveTimes,
    ...overrides,
  }
  return SessionRepository.of(fromAny<SessionRepositoryShape, typeof methods>(methods))
}

function run<A>(effect: Effect.Effect<A, unknown, unknown>, repo = repository()) {
  const provided = effect.pipe(Effect.provideService(SessionRepository, repo))
  return Effect.runPromise(fromAny<Effect.Effect<A, unknown, never>, typeof provided>(provided))
}

function dispatched() {
  return dispatchLocalSessionCommandMock.mock.calls.map(([input]) => ({
    contract: input.payload.contract,
    command: input.payload.request.command,
  }))
}

function succeedFor(input: DispatchedCommand) {
  const { command } = input.payload.request
  if (input.payload.contract === 'local-ui-v1') {
    return Effect.succeed({ contract: 'local-ui-v1', response: { requestId: 'r' } })
  }
  return Effect.succeed({
    contract: 'session-control-v2',
    response: {
      outcome: {
        effect: command.operation === 'archive' ? 'session-archived' : 'session-unarchived',
      },
    },
  })
}

describe('Archived items Host UI operations', () => {
  beforeEach(() => {
    dispatchLocalSessionCommandMock.mockReset().mockImplementation(succeedFor)
    setArchiveTimes.mockClear()
    states = new Map([
      [archivedItemKey(sessionRef), 100],
      [archivedItemKey(branchRef), 200],
    ])
  })

  it('restores sessions and branches through the same commands as restoring one', async () => {
    const result = await run(
      setArchivedItems([{ archived: false, items: [{ ref: sessionRef }, { ref: branchRef }] }]),
    )

    expect(result).toEqual({
      changed: [
        { ref: sessionRef, archivedAt: 100 },
        { ref: branchRef, archivedAt: 200 },
      ],
      skipped: [],
      failed: [],
    })
    expect(dispatched()).toEqual([
      {
        contract: 'session-control-v2',
        command: { operation: 'unarchive', sessionId: 'session-1' },
      },
      {
        contract: 'local-ui-v1',
        command: {
          operation: 'restore-branch',
          sessionId: 'session-2',
          branchId: 'session-2:branch:b',
        },
      },
    ])
  })

  it('skips an item restored elsewhere since it was selected', async () => {
    states.set(archivedItemKey(sessionRef), null)
    const result = await run(
      setArchivedItems([{ archived: false, items: [{ ref: sessionRef }, { ref: branchRef }] }]),
    )

    expect(result).toEqual({
      changed: [{ ref: branchRef, archivedAt: 200 }],
      skipped: [sessionRef],
      failed: [],
    })
    expect(dispatched().map(({ command }) => command.operation)).toEqual(['restore-branch'])
  })

  it('archives again to undo a restore and puts back each Archive time', async () => {
    states = new Map([
      [archivedItemKey(sessionRef), null],
      [archivedItemKey(branchRef), null],
    ])
    await run(
      setArchivedItems([
        {
          archived: true,
          items: [{ ref: sessionRef, archivedAt: 100 }, { ref: branchRef }],
        },
      ]),
    )

    expect(dispatched().map(({ command }) => command.operation)).toEqual([
      'archive',
      'archive-branch',
    ])
    expect(setArchiveTimes).toHaveBeenCalledWith([{ ref: sessionRef, archivedAt: 100 }])
  })

  it('changes a repeated item once', async () => {
    const result = await run(
      setArchivedItems([{ archived: false, items: [{ ref: branchRef }, { ref: branchRef }] }]),
    )
    expect(result.changed).toEqual([{ ref: branchRef, archivedAt: 200 }])
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledTimes(1)
  })

  it('keeps going after one item fails and reports which one', async () => {
    dispatchLocalSessionCommandMock
      .mockImplementationOnce(() => Effect.fail(new Error('Session is busy')))
      .mockImplementation(succeedFor)
    const result = await run(
      setArchivedItems([{ archived: false, items: [{ ref: sessionRef }, { ref: branchRef }] }]),
    )

    expect(result).toEqual({
      changed: [{ ref: branchRef, archivedAt: 200 }],
      skipped: [],
      failed: [{ ref: sessionRef, message: 'Session is busy' }],
    })
  })

  it('deletes only sessions that are still archived', async () => {
    const restored = SessionId('restored-elsewhere')
    states.set(archivedItemKey({ kind: 'session', sessionId: restored }), null)
    const result = await run(deleteArchivedSessions([[sessionRef.sessionId, restored]]))

    expect(result).toEqual({
      deleted: [sessionRef.sessionId],
      skipped: [restored],
      missing: [],
      failed: [],
    })
    expect(dispatched()).toEqual([
      {
        contract: 'local-ui-v1',
        command: { operation: 'delete', sessionId: 'session-1', requireArchived: true },
      },
    ])
  })

  it('keeps a session the Host finds restored when its turn comes, and reports a missing one', async () => {
    const gone = SessionId('deleted-elsewhere')
    dispatchLocalSessionCommandMock.mockImplementation(() =>
      Effect.fail(new Error(`Session Host refused: ${SESSION_NOT_ARCHIVED_MESSAGE}`)),
    )
    const result = await run(deleteArchivedSessions([[sessionRef.sessionId, gone, gone]]))

    expect(result).toEqual({
      deleted: [],
      skipped: [sessionRef.sessionId],
      missing: [gone],
      failed: [],
    })
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledTimes(1)
  })

  it('retries a refused delete after the sessions that blocked it are gone', async () => {
    const queen = SessionId('queen')
    const worker = SessionId('worker')
    states = new Map([
      [archivedItemKey({ kind: 'session', sessionId: queen }), 1],
      [archivedItemKey({ kind: 'session', sessionId: worker }), 2],
    ])
    let workerDeleted = false
    dispatchLocalSessionCommandMock.mockImplementation((input) => {
      const { sessionId } = input.payload.request.command
      if (sessionId === 'queen' && !workerDeleted) {
        return Effect.fail(new Error('Active Workers must be deleted first'))
      }
      if (sessionId === 'worker') workerDeleted = true
      return succeedFor(input)
    })

    const result = await run(deleteArchivedSessions([[queen, worker]]))

    expect(result).toEqual({ deleted: [worker, queen], skipped: [], missing: [], failed: [] })
  })

  it('reports a delete that keeps failing, without looping', async () => {
    dispatchLocalSessionCommandMock.mockImplementation(() =>
      Effect.fail(new Error('Session is running')),
    )
    const result = await run(deleteArchivedSessions([[sessionRef.sessionId]]))

    expect(result).toEqual({
      deleted: [],
      skipped: [],
      missing: [],
      failed: [{ sessionId: sessionRef.sessionId, message: 'Session is running' }],
    })
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledTimes(1)
  })

  it('reads the reason a wrapped store failure gives, and keeps a session the journal refused', async () => {
    const queen = SessionId('queen-with-workers')
    states.set(archivedItemKey({ kind: 'session', sessionId: queen }), 5)
    dispatchLocalSessionCommandMock.mockImplementation((input) =>
      Effect.fail(
        new SessionProjectionRepositoryError({
          operation: 'delete',
          cause: new Error(
            input.payload.request.command.sessionId === 'queen-with-workers'
              ? 'Session deletion was refused because worker w1 still depends on it.'
              : SESSION_NOT_ARCHIVED_MESSAGE,
          ),
        }),
      ),
    )
    const result = await run(deleteArchivedSessions([[sessionRef.sessionId, queen]]))

    expect(result).toEqual({
      deleted: [],
      skipped: [sessionRef.sessionId],
      missing: [],
      failed: [
        {
          sessionId: queen,
          message: 'Session deletion was refused because worker w1 still depends on it.',
        },
      ],
    })
  })
})
