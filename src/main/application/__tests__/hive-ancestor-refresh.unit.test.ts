import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { HiveAncestry } from '../../ports/hive-ancestry'
import { mayChangeWorkerRuns, refreshHiveAncestors } from '../hive-ancestor-refresh'

const ANCESTORS: Readonly<Record<string, readonly string[]>> = {
  implementer: ['planner', 'queen'],
  queen: [],
}

async function refresh(payload: SessionHostEventPayload) {
  const published: SessionHostEventPayload[] = []
  const looked: string[] = []
  await Effect.runPromise(
    refreshHiveAncestors(payload, (event) => published.push(event)).pipe(
      Effect.provideService(HiveAncestry, {
        ancestorsOf: (sessionId) => {
          looked.push(sessionId)
          return Effect.succeed(ANCESTORS[sessionId] ?? [])
        },
      }),
    ),
  )
  return { published, looked }
}

describe('Hive ancestor refresh (ADR 0065)', () => {
  it("republishes every ancestor's catalog entry when a Worker's Run settles", async () => {
    const { published } = await refresh({
      kind: 'session-state-changed',
      sessionId: 'implementer',
      stateRevision: 4,
      operation: 'run-settled',
      runId: 'run-1',
      terminalStatus: 'completed',
    })
    expect(published).toEqual([
      { kind: 'session-list-changed', sessionId: 'planner', change: 'updated', catalogOnly: true },
      { kind: 'session-list-changed', sessionId: 'queen', change: 'updated', catalogOnly: true },
    ])
  })

  it('publishes nothing for a root, and ignores its own catalog-only changes', async () => {
    expect(
      (
        await refresh({
          kind: 'session-state-changed',
          sessionId: 'queen',
          stateRevision: 1,
          operation: 'message',
        })
      ).published,
    ).toEqual([])
    const ownEcho = await refresh({
      kind: 'session-list-changed',
      sessionId: 'implementer',
      change: 'updated',
      catalogOnly: true,
    })
    expect(ownEcho.looked).toEqual([])
    expect(ownEcho.published).toEqual([])
  })

  it('treats a mutation, a settlement and agent_start as Run changes, and nothing else', () => {
    expect(
      mayChangeWorkerRuns({
        kind: 'session-state-changed',
        sessionId: 's',
        stateRevision: 1,
        operation: 'start',
      }),
    ).toBe(true)
    expect(
      mayChangeWorkerRuns({
        kind: 'session-transport',
        sessionId: 's',
        event: { type: 'agent_start', timestamp: 1, runId: 'r' },
      }),
    ).toBe(true)
    expect(
      mayChangeWorkerRuns({
        kind: 'session-list-changed',
        sessionId: 's',
        change: 'updated',
      }),
    ).toBe(false)
  })
})
