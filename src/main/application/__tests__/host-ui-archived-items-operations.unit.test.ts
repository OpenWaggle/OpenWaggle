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

import {
  listArchivedItemRefs,
  queryArchivedItems,
  setArchivedItems,
} from '../host-ui-archived-items-operations'

function run<A>(effect: Effect.Effect<A, unknown, unknown>) {
  return Effect.runPromise(fromAny<Effect.Effect<A, unknown, never>, typeof effect>(effect))
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

const sessionRef = { kind: 'session', sessionId: SessionId('session-1') } as const
const branchRef = {
  kind: 'branch',
  sessionId: SessionId('session-2'),
  branchId: SessionBranchId('session-2:branch:b'),
} as const

describe('Archived items Host UI operations', () => {
  beforeEach(() => {
    dispatchLocalSessionCommandMock.mockReset().mockImplementation(succeedFor)
  })

  it('restores sessions and branches through the same commands as restoring one', async () => {
    const result = await run(
      setArchivedItems([{ archived: false, items: [sessionRef, branchRef] }]),
    )

    expect(result).toEqual({ changed: [sessionRef, branchRef], failed: [] })
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

  it('archives again to undo a restore', async () => {
    await run(setArchivedItems([{ archived: true, items: [sessionRef, branchRef] }]))
    expect(dispatched().map(({ command }) => command.operation)).toEqual([
      'archive',
      'archive-branch',
    ])
  })

  it('keeps going after one item fails and reports which one', async () => {
    dispatchLocalSessionCommandMock
      .mockImplementationOnce(() => Effect.fail(new Error('Session is busy')))
      .mockImplementation(succeedFor)
    const result = await run(
      setArchivedItems([{ archived: false, items: [sessionRef, branchRef] }]),
    )

    expect(result).toEqual({
      changed: [branchRef],
      failed: [{ ref: sessionRef, message: 'Session is busy' }],
    })
  })

  it('rejects an empty or malformed change before dispatching anything', async () => {
    await expect(run(setArchivedItems([{ archived: false, items: [] }]))).rejects.toThrow(
      /Archived items change is invalid/u,
    )
    await expect(
      run(setArchivedItems([{ archived: false, items: [{ kind: 'branch', sessionId: 's' }] }])),
    ).rejects.toThrow(/invalid/u)
    expect(dispatchLocalSessionCommandMock).not.toHaveBeenCalled()
  })

  it('validates a query and hands it to the repository unchanged', async () => {
    const queryArchived = vi.fn((_query: unknown) =>
      emptySessionCatalogMethods.queryArchivedItems(),
    )
    const methods = { ...emptySessionCatalogMethods, queryArchivedItems: queryArchived }
    const repository = SessionRepository.of(
      fromAny<SessionRepositoryShape, typeof methods>(methods),
    )
    const query = { text: 'oauth', kind: 'session', archivedWithin: 'week', limit: 50 }
    await run(
      queryArchivedItems([query]).pipe(Effect.provideService(SessionRepository, repository)),
    )

    expect(queryArchived).toHaveBeenCalledWith(query)
    await expect(
      run(
        queryArchivedItems([{ ...query, limit: 0 }]).pipe(
          Effect.provideService(SessionRepository, repository),
        ),
      ),
    ).rejects.toThrow(/Archived items query is invalid/u)
    await expect(
      run(
        queryArchivedItems([{ ...query, cursor: 'not-a-number' }]).pipe(
          Effect.provideService(SessionRepository, repository),
        ),
      ),
    ).rejects.toThrow(/invalid/u)
  })

  it('caps Select all at the bulk limit', async () => {
    const repository = SessionRepository.of(
      fromAny<SessionRepositoryShape, typeof emptySessionCatalogMethods>(
        emptySessionCatalogMethods,
      ),
    )
    await expect(
      run(
        listArchivedItemRefs([{ limit: 1_001 }]).pipe(
          Effect.provideService(SessionRepository, repository),
        ),
      ),
    ).rejects.toThrow(/selection query is invalid/u)
  })
})
