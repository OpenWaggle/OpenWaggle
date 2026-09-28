import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { DesktopServiceCommand } from '@shared/types/desktop-service'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { seedHiveWorker } from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { ActionRunService } from '../../ports/action-run-service'
import { DesktopServiceBroker } from '../../ports/desktop-service-broker'
import { reconcileHiveWorkerCleanup } from '../hive-worker-cleanup-service'
import {
  archivedState,
  bindWorkerWorkspace,
  runningService,
  useHiveCleanupServiceContext,
  withTerminals,
} from './hive-worker-cleanup-service.test-harness'

/**
 * Terminals, browser previews, and project services the user started in a Worker are not
 * journaled, and archiving would destroy them, so they count as user activity.
 */
describe('Hive Worker cleanup and live desktop state', () => {
  const service = useHiveCleanupServiceContext('openwaggle-hive-cleanup-desktop-')

  it('keeps a Worker with an open terminal instead of killing the shell', async () => {
    const closedOwners: string[] = []
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* withTerminals(
          () => ({
            getActivitySnapshot: () =>
              Effect.succeed({
                revision: 3,
                truncated: false,
                summaries: [
                  {
                    ownerKey: 'worker',
                    terminalId: 'terminal-1',
                    activityStatus: 'running',
                    processName: 'pnpm',
                    ports: [5173],
                    projectActionPending: false,
                  },
                ],
              }),
            closeAllForOwner: (ownerKey) =>
              Effect.sync(() => {
                closedOwners.push(ownerKey)
              }),
          }),
          reconcileHiveWorkerCleanup(SessionId('queen')),
        )
        return yield* archivedState(sql, 'worker')
      }).pipe(Effect.provide(service.store('open-terminal'))),
    )

    expect({ archived, closedOwners }).toEqual({ archived: 0, closedOwners: [] })
    expect(service.events).toEqual([])
  })

  it('re-checks terminals inside the desktop fence, before tearing anything down', async () => {
    const calls: string[] = []
    const snapshots = [
      { revision: 1, truncated: false, summaries: [] },
      {
        revision: 2,
        truncated: false,
        summaries: [
          {
            ownerKey: 'worker',
            terminalId: 'terminal-opened-meanwhile',
            activityStatus: 'idle' as const,
            processName: null,
            ports: [],
            projectActionPending: false,
          },
        ],
      },
    ]
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* withTerminals(
          () => ({
            getActivitySnapshot: () =>
              Effect.sync(() => {
                calls.push('snapshot')
                return snapshots.shift() ?? { revision: 3, truncated: false, summaries: [] }
              }),
            runWithMutationFence: (_scope, operation) =>
              Effect.sync(() => calls.push('fence')).pipe(Effect.zipRight(operation)),
            closeAllForOwner: () => Effect.sync(() => calls.push('close')),
          }),
          reconcileHiveWorkerCleanup(SessionId('worker')),
        )
        return yield* archivedState(sql, 'worker')
      }).pipe(Effect.provide(service.store('fenced-terminal-check'))),
    )

    expect({ archived, calls }).toEqual({ archived: 0, calls: ['snapshot', 'fence', 'snapshot'] })
  })

  it('keeps a Worker when the terminal snapshot is truncated and could hide its shell', async () => {
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* withTerminals(
          () => ({
            getActivitySnapshot: () =>
              Effect.succeed({ revision: 9, truncated: true, summaries: [] }),
          }),
          reconcileHiveWorkerCleanup(SessionId('worker')),
        )
        return yield* archivedState(sql, 'worker')
      }).pipe(Effect.provide(service.store('truncated-terminals'))),
    )

    expect(archived).toBe(0)
  })

  it('keeps a Worker that is open in the app or has browser previews', async () => {
    const deletedOwners: string[] = []
    const inspectedOwners: string[] = []
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* reconcileHiveWorkerCleanup(SessionId('worker')).pipe(
          Effect.provideService(
            DesktopServiceBroker,
            fromPartial<DesktopServiceBroker['Type']>({
              execute: (command: DesktopServiceCommand) => {
                if (command.service === 'browser' && command.operation === 'inspectOwner') {
                  inspectedOwners.push(command.ownerKey)
                  return Effect.succeed({
                    service: 'browser',
                    operation: 'inspectOwner',
                    value: { registered: true, previews: 0 },
                  })
                }
                if (command.service === 'browser' && command.operation === 'deleteOwner') {
                  deletedOwners.push(command.ownerKey)
                  return Effect.succeed({
                    service: 'browser',
                    operation: 'deleteOwner',
                    value: null,
                  })
                }
                return Effect.dieMessage('Unexpected desktop command in Hive cleanup test')
              },
            }),
          ),
        )
        return yield* archivedState(sql, 'worker')
      }).pipe(Effect.provide(service.store('browser-owner'))),
    )

    expect({ archived, inspectedOwners, deletedOwners }).toEqual({
      archived: 0,
      inspectedOwners: ['worker'],
      deletedOwners: [],
    })
  })

  it('keeps a Worker whose archive would stop a running project service', async () => {
    const stoppedWorkspaces: string[] = []
    const actions = {
      list: () => Effect.succeed([runningService()]),
      stopWorkspaceServices: (workspaceId: string) =>
        Effect.sync(() => {
          stoppedWorkspaces.push(workspaceId)
        }),
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* bindWorkerWorkspace(sql, ['worker'])
        const base = yield* ActionRunService
        yield* reconcileHiveWorkerCleanup(SessionId('worker')).pipe(
          Effect.provideService(ActionRunService, { ...base, ...actions }),
        )
        return { archived: yield* archivedState(sql, 'worker'), stoppedWorkspaces }
      }).pipe(Effect.provide(service.store('running-service'))),
    )

    expect(result).toEqual({ archived: 0, stoppedWorkspaces: [] })
  })

  it('archives a Worker whose running service stays alive for another Session', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* bindWorkerWorkspace(sql, ['worker', 'queen'])
        const base = yield* ActionRunService
        yield* reconcileHiveWorkerCleanup(SessionId('worker')).pipe(
          Effect.provideService(ActionRunService, {
            ...base,
            list: () => Effect.succeed([runningService()]),
          }),
        )
        return yield* archivedState(sql, 'worker')
      }).pipe(Effect.provide(service.store('shared-service'))),
    )

    expect(result).toBe(1)
  })
})
