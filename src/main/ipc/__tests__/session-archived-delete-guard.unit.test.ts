import { SESSION_NOT_ARCHIVED_MESSAGE } from '@shared/types/archived-items'
import type { SessionId } from '@shared/types/brand'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnboundWorkspaceTestLayer } from '../../application/__tests__/unbound-workspace-test-layer'
import { DesktopServiceBroker } from '../../ports/desktop-service-broker'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { type TerminalMutationScope, TerminalService } from '../../ports/terminal-service'

const { waitForSessionRunsMock } = vi.hoisted(() => ({
  waitForSessionRunsMock: vi.fn(async () => true),
}))
vi.mock('../../application/active-session-runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/active-session-runs')>()),
  waitForSessionRuns: waitForSessionRunsMock,
}))

import { executeLocalUiSessionCommand } from '../../application/local-ui-session-service'

const SESSION = 'session-target'
const order: string[] = []
/** The archive state each read returns, in turn; the last one repeats. */
let archiveStates: (number | null)[] = []

function testLayer() {
  return Layer.mergeAll(
    UnboundWorkspaceTestLayer,
    Layer.succeed(
      TerminalService,
      fromPartial<TerminalService['Type']>({
        closeAllForOwner: () => Effect.sync(() => order.push('terminals')),
        runWithMutationFence: <A, E, R>(
          _scope: TerminalMutationScope,
          operation: Effect.Effect<A, E, R>,
        ) => operation,
      }),
    ),
    Layer.succeed(
      DesktopServiceBroker,
      fromPartial<DesktopServiceBroker['Type']>({
        execute: () =>
          Effect.succeed({ service: 'browser', operation: 'deleteOwner', value: null } as const),
      }),
    ),
    Layer.succeed(
      InlineVisualizationService,
      fromPartial<InlineVisualizationService['Type']>({
        stageSessionDeletion: () => Effect.succeed({ commit: Effect.void, rollback: Effect.void }),
      }),
    ),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepository['Type']>({
        delete: () => Effect.sync(() => order.push('delete')),
      }),
    ),
    Layer.succeed(
      SessionRepository,
      fromPartial<SessionRepository['Type']>({
        listByIds: (ids: readonly SessionId[]) =>
          Effect.succeed(
            ids.map((id) => ({
              id,
              title: 'Session',
              projectPath: null,
              createdAt: 1,
              updatedAt: 1,
            })),
          ),
        readArchivedItemStates: () =>
          Effect.sync(() => {
            order.push('check')
            const state = archiveStates.length > 1 ? archiveStates.shift() : archiveStates[0]
            return new Map([[`session:${SESSION}`, state ?? null]])
          }),
      }),
    ),
  )
}

function deleteRequiringArchived() {
  const effect = executeLocalUiSessionCommand({
    caller: { callerId: 'gui:local-user' },
    payload: {
      contract: 'local-ui-v1',
      request: {
        requestId: 'delete-archived',
        command: { operation: 'delete', sessionId: SESSION, requireArchived: true },
      },
    },
  }).pipe(Effect.provide(testLayer()))
  return Effect.runPromise(fromAny<Effect.Effect<unknown, unknown, never>, typeof effect>(effect))
}

describe('Deleting from Archived items', () => {
  beforeEach(() => {
    order.length = 0
    archiveStates = [100]
    waitForSessionRunsMock.mockClear()
  })

  it('deletes a session that is still archived, checking before and inside the removal fence', async () => {
    await deleteRequiringArchived()
    expect(order).toEqual(['check', 'check', 'terminals', 'delete', 'terminals'])
  })

  it('keeps a session restored before the delete, without stopping its runs', async () => {
    archiveStates = [null]
    await expect(deleteRequiringArchived()).rejects.toThrow(SESSION_NOT_ARCHIVED_MESSAGE)
    expect(order).toEqual(['check'])
    expect(waitForSessionRunsMock).not.toHaveBeenCalled()
  })

  it('keeps a session restored while its runs were stopping', async () => {
    archiveStates = [100, null]
    await expect(deleteRequiringArchived()).rejects.toThrow(SESSION_NOT_ARCHIVED_MESSAGE)
    expect(order).toEqual(['check', 'check'])
  })
})
