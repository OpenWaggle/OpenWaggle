import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'

const { publishSessionHostEventMock } = vi.hoisted(() => ({
  publishSessionHostEventMock: vi.fn(),
}))
vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
}))

const { changesOnlySessionCatalogEntry, executeLocalUiSessionCommand } = await import(
  '../local-ui-session-service'
)

const SESSION = 'session-1'

function testLayer() {
  return Layer.mergeAll(
    Layer.succeed(
      SessionRepository,
      fromPartial<SessionRepository['Type']>({ updateTreeUiState: () => Effect.void }),
    ),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepository['Type']>({ pinSession: () => Effect.void }),
    ),
  )
}

function runCommand(command: Parameters<typeof changesOnlySessionCatalogEntry>[0]) {
  const effect = executeLocalUiSessionCommand({
    caller: { callerId: 'gui:local-user' },
    payload: { contract: 'local-ui-v1', request: { requestId: 'request-1', command } },
  }).pipe(Effect.provide(testLayer()))
  return Effect.runPromise(fromAny<Effect.Effect<unknown, unknown, never>, typeof effect>(effect))
}

describe('Local UI commands that change only a Session’s catalog entry (session open)', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockClear()
  })

  it('marks the read receipt opening a Session writes, so windows do not read it again', async () => {
    await runCommand({
      operation: 'update-tree-ui-state',
      sessionId: SESSION,
      patch: { lastVisitedAt: 10 },
    })

    expect(publishSessionHostEventMock).toHaveBeenCalledWith({
      kind: 'session-list-changed',
      sessionId: SESSION,
      change: 'updated',
      catalogOnly: true,
    })
  })

  it('marks a pin, and not a tree UI change other windows show', async () => {
    await runCommand({ operation: 'pin', sessionId: SESSION })
    await runCommand({
      operation: 'update-tree-ui-state',
      sessionId: SESSION,
      patch: { lastVisitedAt: 10, branchesSidebarCollapsed: true },
    })

    expect(publishSessionHostEventMock.mock.calls.map(([event]) => event.catalogOnly)).toEqual([
      true,
      undefined,
    ])
  })

  it('names the commands that leave the transcript and tree as they were', () => {
    expect(changesOnlySessionCatalogEntry({ operation: 'unpin', sessionId: SESSION })).toBe(true)
    expect(
      changesOnlySessionCatalogEntry({
        operation: 'update-tree-ui-state',
        sessionId: SESSION,
        patch: { expandedNodeIds: ['node-1'] },
      }),
    ).toBe(false)
    expect(
      changesOnlySessionCatalogEntry({
        operation: 'rename-branch',
        sessionId: SESSION,
        branchId: 'branch-1',
        name: 'Next',
      }),
    ).toBe(false)
  })
})
