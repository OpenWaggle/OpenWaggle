import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { emptySessionCatalogMethods } from './session-repository-test-support'

const { dispatchLocalSessionCommandMock } = vi.hoisted(() => ({
  dispatchLocalSessionCommandMock: vi.fn(),
}))

vi.mock('../local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))

import {
  listArchivedItemRefs,
  queryArchivedItems,
  setArchivedItems,
} from '../host-ui-archived-items-operations'

function repository(overrides: Partial<SessionRepositoryShape> = {}) {
  const methods = { ...emptySessionCatalogMethods, ...overrides }
  return SessionRepository.of(fromAny<SessionRepositoryShape, typeof methods>(methods))
}

function run<A>(effect: Effect.Effect<A, unknown, unknown>, repo = repository()) {
  const provided = effect.pipe(Effect.provideService(SessionRepository, repo))
  return Effect.runPromise(fromAny<Effect.Effect<A, unknown, never>, typeof provided>(provided))
}

describe('Archived items Host UI input validation', () => {
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
