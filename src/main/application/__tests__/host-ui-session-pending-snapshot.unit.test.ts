import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { clearAgentLoopInteractionBrokerForTests } from '../agent-loop-interaction-broker'
import { listSessionCatalogPage, listSessionsByIds } from '../host-ui-session-catalog-operations'

const sessionId = SessionId('session-pending-snapshot')
const summary = {
  id: sessionId,
  title: 'Snapshot Session',
  projectPath: '/repo',
  createdAt: 1,
  updatedAt: 100,
  latestRun: { status: 'active' as const, updatedAt: 100 },
}
const repository = fromPartial<SessionRepositoryShape>({
  listByIds: () => Effect.succeed([summary]),
  listCatalogPage: () => Effect.succeed({ sessions: [summary] }),
})
const layer = Layer.succeed(SessionRepository, repository)

afterEach(() => {
  vi.restoreAllMocks()
  clearAgentLoopInteractionBrokerForTests()
})

describe('Host pending-interaction catalog snapshots', () => {
  it('stamps empty pending sets on direct and paged Session summaries', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(160)

    const direct = await Effect.runPromise(
      listSessionsByIds([[sessionId]]).pipe(Effect.provide(layer)),
    )
    const page = await Effect.runPromise(
      listSessionCatalogPage([false, 100]).pipe(Effect.provide(layer)),
    )

    expect(direct).toEqual([{ ...summary, pendingInteractionSnapshotAt: 160 }])
    expect(page.sessions).toEqual([{ ...summary, pendingInteractionSnapshotAt: 160 }])
  })
})
