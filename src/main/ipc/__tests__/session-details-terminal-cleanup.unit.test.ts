import { SessionId } from '@shared/types/brand'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { DesktopServiceBroker } from '../../ports/desktop-service-broker'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import type { SessionOrganizationRequest } from '../../ports/session-organization-repository'
import { SessionOrganizationRepository } from '../../ports/session-organization-repository'
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

import {
  ensureSessionRunStartAllowed,
  isSessionRemovalFenced,
} from '../../application/active-session-runs'
import { executeLocalUiSessionCommand } from '../../application/local-ui-session-service'
import { organizeSession } from '../../application/session-organization-service'

const closed: Array<readonly [string, boolean]> = []
const order: string[] = []
const scopes: unknown[] = []
let terminalError: Error | null = null
let historyError: Error | null = null
let browserError: Error | null = null
let mutationError: Error | null = null
let stopBarrier: Promise<void> | null = null
let ownerDeleted = false
const commitVisualization = vi.fn()
const rollbackVisualization = vi.fn()

function testLayer() {
  return Layer.mergeAll(
    Layer.succeed(
      TerminalService,
      fromPartial<TerminalService['Type']>({
        closeAllForOwner: (ownerKey: string, deleteHistory: boolean) =>
          Effect.gen(function* () {
            closed.push([ownerKey, deleteHistory])
            order.push(deleteHistory ? 'terminal:delete-history' : 'terminal:stop')
            if (!deleteHistory && stopBarrier !== null)
              yield* Effect.promise(() => stopBarrier ?? Promise.resolve())
            const failure = deleteHistory ? historyError : terminalError
            if (failure !== null) return yield* Effect.fail(failure)
          }),
        runWithMutationFence: <A, E, R>(
          scope: TerminalMutationScope,
          operation: Effect.Effect<A, E, R>,
        ) => {
          scopes.push(scope)
          return operation
        },
      }),
    ),
    Layer.succeed(
      DesktopServiceBroker,
      fromPartial<DesktopServiceBroker['Type']>({
        execute: () =>
          Effect.gen(function* () {
            order.push('browser:stop')
            if (browserError !== null) return yield* Effect.fail(browserError)
            return { service: 'browser', operation: 'deleteOwner', value: null } as const
          }),
      }),
    ),
    Layer.succeed(
      InlineVisualizationService,
      fromPartial<InlineVisualizationService['Type']>({
        stageSessionDeletion: () =>
          Effect.succeed({
            commit: Effect.sync(commitVisualization),
            rollback: Effect.sync(rollbackVisualization),
          }),
      }),
    ),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepository['Type']>({
        delete: () =>
          Effect.gen(function* () {
            order.push('delete')
            if (mutationError !== null) {
              return yield* Effect.fail(
                new SessionProjectionRepositoryError({ operation: 'delete', cause: mutationError }),
              )
            }
            ownerDeleted = true
          }),
      }),
    ),
    Layer.succeed(
      SessionRepository,
      fromPartial<SessionRepository['Type']>({
        listByIds: (ids: readonly SessionId[]) =>
          Effect.succeed(
            ownerDeleted
              ? []
              : ids.map((id) => ({
                  id,
                  title: 'Session',
                  projectPath: null,
                  createdAt: 1,
                  updatedAt: 1,
                })),
          ),
      }),
    ),
    Layer.succeed(
      SessionOrganizationRepository,
      fromPartial<SessionOrganizationRepository['Type']>({
        prepareArchive: () => Effect.succeed({ status: 'ready' }),
        execute: (input: { readonly request: SessionOrganizationRequest }) =>
          Effect.sync(() => {
            order.push('archive')
            return {
              contractVersion: input.request.contractVersion,
              requestId: input.request.requestId,
              idempotencyKey: input.request.idempotencyKey,
              replayed: false,
              outcome: {
                operation: 'archive',
                effect: 'session-archived',
                sessionId: input.request.command.sessionId,
              },
            } as const
          }),
      }),
    ),
  )
}

function invoke(mutation: 'delete' | 'archive', id = 'session-target') {
  const effect: Effect.Effect<void, unknown, unknown> =
    mutation === 'delete'
      ? executeLocalUiSessionCommand({
          caller: { callerId: 'gui:local-user' },
          payload: {
            contract: 'local-ui-v1',
            request: {
              requestId: 'delete-request',
              command: { operation: 'delete', sessionId: id },
            },
          },
        }).pipe(Effect.asVoid)
      : organizeSession({
          callerId: 'gui:local-user',
          request: {
            contractVersion: 2,
            requestId: 'archive-request',
            idempotencyKey: 'archive-key',
            command: { operation: 'archive', sessionId: id },
          },
        }).pipe(Effect.asVoid)
  const provided = effect.pipe(Effect.provide(testLayer()))
  return Effect.runPromise(fromAny<Effect.Effect<void, unknown, never>, typeof provided>(provided))
}

describe('Host-owned Session terminal cleanup', () => {
  beforeEach(() => {
    closed.length = 0
    order.length = 0
    scopes.length = 0
    terminalError = null
    historyError = null
    browserError = null
    mutationError = null
    stopBarrier = null
    ownerDeleted = false
    commitVisualization.mockReset()
    rollbackVisualization.mockReset()
    waitForSessionRunsMock.mockReset().mockResolvedValue(true)
  })

  it('stops owned terminals and browser before deletion, then deletes scrollback', async () => {
    await invoke('delete')
    expect(closed).toEqual([
      ['session-target', false],
      ['session-target', true],
    ])
    expect(order).toEqual(['terminal:stop', 'browser:stop', 'delete', 'terminal:delete-history'])
    expect(scopes).toEqual([{ kind: 'owner', ownerKey: 'session-target' }])
    expect(commitVisualization).toHaveBeenCalledOnce()
  })

  it('stops archived Session terminals and browser without deleting retained history', async () => {
    await invoke('archive')
    expect(closed).toEqual([['session-target', false]])
    expect(order).toEqual(['terminal:stop', 'browser:stop', 'archive'])
    expect(scopes).toEqual([{ kind: 'owner', ownerKey: 'session-target' }])
  })

  it.each(['delete', 'archive'] as const)(
    'does not %s when native terminal shutdown fails',
    async (mutation) => {
      terminalError = new Error('process tree still running')
      await expect(invoke(mutation)).rejects.toThrow('process tree still running')
      expect(order).toEqual(['terminal:stop'])
      expect(isSessionRemovalFenced(SessionId('session-target'))).toBe(false)
    },
  )

  it('does not delete when the owned browser cleanup cannot be acknowledged', async () => {
    browserError = new Error('desktop disconnected')
    await expect(invoke('delete')).rejects.toThrow('desktop disconnected')
    expect(order).toEqual(['terminal:stop', 'browser:stop'])
    expect(ownerDeleted).toBe(false)
  })

  it('waits for cancelled work before native cleanup or deletion', async () => {
    const settlement = Promise.withResolvers<boolean>()
    waitForSessionRunsMock.mockReturnValue(settlement.promise)
    const deletion = invoke('delete')
    await vi.waitFor(() => expect(waitForSessionRunsMock).toHaveBeenCalledOnce())
    expect(order).toEqual([])
    settlement.resolve(true)
    await deletion
    expect(ownerDeleted).toBe(true)
  })

  it('holds Host run admission until the desktop fence and durable mutation settle', async () => {
    const stopped = Promise.withResolvers<void>()
    stopBarrier = stopped.promise
    const deletion = invoke('delete')
    await vi.waitFor(() => expect(closed).toEqual([['session-target', false]]))
    expect(isSessionRemovalFenced(SessionId('session-target'))).toBe(true)
    await expect(
      Effect.runPromise(ensureSessionRunStartAllowed(SessionId('session-target'))),
    ).rejects.toThrow('being archived or deleted')
    stopped.resolve()
    await deletion
    expect(isSessionRemovalFenced(SessionId('session-target'))).toBe(false)
  })

  it.each(['delete', 'archive'] as const)(
    'leaves %s unchanged when a run does not settle',
    async (mutation) => {
      waitForSessionRunsMock.mockResolvedValue(false)
      await expect(invoke(mutation)).rejects.toThrow('session was left unchanged')
      expect(order).toEqual([])
      expect(isSessionRemovalFenced(SessionId('session-target'))).toBe(false)
    },
  )

  it('restores visualization staging and retains history if durable deletion fails', async () => {
    mutationError = new Error('database unavailable')
    await expect(invoke('delete')).rejects.toThrow()
    expect(rollbackVisualization).toHaveBeenCalledOnce()
    expect(commitVisualization).not.toHaveBeenCalled()
    expect(closed).toEqual([['session-target', false]])
  })

  it('keeps a committed deletion when deferred history cleanup fails', async () => {
    historyError = new Error('history file busy')
    await invoke('delete')
    expect(ownerDeleted).toBe(true)
    expect(commitVisualization).toHaveBeenCalledOnce()
    expect(rollbackVisualization).not.toHaveBeenCalled()
    expect(closed).toEqual([
      ['session-target', false],
      ['session-target', true],
    ])
  })
})
