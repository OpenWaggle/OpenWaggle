import { type ArchivedItemRef, archivedItemKey } from '@shared/types/archived-items'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import {
  deleteArchivedSessions,
  listArchivedItemRefs,
  queryArchivedItems,
  setArchivedItems,
} from '../host-ui-archived-items-operations'

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

  it('rejects an empty or malformed change before dispatching anything', async () => {
    await expect(run(setArchivedItems([{ archived: false, items: [] }]))).rejects.toThrow(
      /Archived items change is invalid/u,
    )
    await expect(
      run(
        setArchivedItems([
          { archived: false, items: [{ ref: { kind: 'branch', sessionId: 's' } }] },
        ]),
      ),
    ).rejects.toThrow(/invalid/u)
    expect(dispatchLocalSessionCommandMock).not.toHaveBeenCalled()
  })

  it('deletes only sessions that are still archived', async () => {
    const restored = SessionId('restored-elsewhere')
    states.set(archivedItemKey({ kind: 'session', sessionId: restored }), null)
    const result = await run(deleteArchivedSessions([[sessionRef.sessionId, restored]]))

    expect(result).toEqual({ deleted: [sessionRef.sessionId], skipped: [restored], failed: [] })
    expect(dispatched()).toEqual([
      { contract: 'local-ui-v1', command: { operation: 'delete', sessionId: 'session-1' } },
    ])
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

    expect(result).toEqual({ deleted: [worker, queen], skipped: [], failed: [] })
  })

  it('reports a delete that keeps failing, without looping', async () => {
    dispatchLocalSessionCommandMock.mockImplementation(() =>
      Effect.fail(new Error('Session is running')),
    )
    const result = await run(deleteArchivedSessions([[sessionRef.sessionId]]))

    expect(result).toEqual({
      deleted: [],
      skipped: [],
      failed: [{ sessionId: sessionRef.sessionId, message: 'Session is running' }],
    })
    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledTimes(1)
  })

  it('validates a query and hands it to the repository unchanged', async () => {
    const queryArchived = vi.fn((_query: unknown) =>
      emptySessionCatalogMethods.queryArchivedItems(),
    )
    const repo = repository({ queryArchivedItems: queryArchived })
    const query = { text: 'oauth', kind: 'session', archivedWithin: 'week', limit: 50 }
    await run(queryArchivedItems([query]), repo)

    expect(queryArchived).toHaveBeenCalledWith(query)
    await expect(run(queryArchivedItems([{ ...query, limit: 0 }]), repo)).rejects.toThrow(
      /Archived items query is invalid/u,
    )
    await expect(
      run(queryArchivedItems([{ ...query, cursor: 'not-a-number' }]), repo),
    ).rejects.toThrow(/invalid/u)
  })

  it('caps Select all at the bulk limit and accepts the list sort', async () => {
    await expect(run(listArchivedItemRefs([{ limit: 1_001 }]))).rejects.toThrow(
      /selection query is invalid/u,
    )
    await expect(run(listArchivedItemRefs([{ sort: 'oldest', limit: 10 }]))).resolves.toEqual({
      refs: [],
      total: 0,
    })
  })
})
