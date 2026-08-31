import { Effect, Ref } from 'effect'
import type { McpRuntimeServiceShape } from '../../../ports/mcp-runtime-service'
import type { McpTurnStateServiceShape } from '../../../ports/mcp-turn-state-service'
import { makeEffectReadWriteGate } from '../../../utils/effect-read-write-gate'
import { makeMcpTurnState } from '../mcp-turn-state-service'
import { callMcpAppTool } from './app-tool-caller'
import { browseMcpCapabilities } from './capability-browser'
import { getMcpPrompt, operateMcpTask, readMcpResource } from './capability-operations'
import { listMcpDirectTools } from './direct-tools'
import { executeMcpGateway } from './gateway-executor'
import { reviewMcpRemoteSkill } from './remote-skills'
import type { McpRemoteTaskStore } from './remote-task-store'
import { runMcpRuntimeDoctor } from './runtime-doctor'
import { makeMcpRuntimeSnapshotAuthority } from './runtime-snapshot-authority'
import { makeMcpRuntimeState } from './runtime-state'
import type { McpConnectionFactory } from './types'

function clearPendingInvalidation(pending: Ref.Ref<Set<string>>, sessionId: string) {
  return Ref.update(pending, (current) => {
    if (!current.has(sessionId)) return current
    const next = new Set(current)
    next.delete(sessionId)
    return next
  })
}

function takePendingInvalidation(pending: Ref.Ref<Set<string>>, sessionId: string) {
  return Ref.modify(pending, (current) => {
    if (!current.has(sessionId)) return [false, current] as const
    const next = new Set(current)
    next.delete(sessionId)
    return [true, next] as const
  })
}

interface McpRuntimeServiceInput {
  readonly connect: McpConnectionFactory
  readonly createHandleKey?: () => Buffer
  readonly remoteTaskStore?: McpRemoteTaskStore
  readonly turnState?: McpTurnStateServiceShape
}

/**
 * Build the Effect-native first-party MCP runtime service. The returned object
 * IS the {@link McpRuntimeServiceShape}: every method is an Effect, all mutable
 * coordination lives in Refs (see {@link makeMcpRuntimeState}), and the only
 * Promise edges are the SDK connect factory and the remote-task store.
 *
 * Turn lifecycle is recorded through the injected {@link McpTurnStateServiceShape}
 * (the shared turn-state service in production, or a fresh in-memory instance in
 * tests/CLI), consumed as Effects via `yield*` — no synchronous bridge.
 */
export function makeMcpRuntimeService(
  input: McpRuntimeServiceInput,
): Effect.Effect<McpRuntimeServiceShape> {
  return Effect.gen(function* () {
    const turnState = input.turnState ?? (yield* makeMcpTurnState())
    const state = yield* makeMcpRuntimeState(input)
    const pendingInvalidations = yield* Ref.make(new Set<string>())
    const lifecycleGate = yield* makeEffectReadWriteGate()
    const snapshotAuthority = yield* makeMcpRuntimeSnapshotAuthority()

    const withLifecycleRead = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
      lifecycleGate.read(Effect.uninterruptible(operation))

    const withAuthoritativeSnapshot = <A, E, R>(
      snapshot: Parameters<typeof snapshotAuthority.assert>[0],
      operation: Effect.Effect<A, E, R>,
    ) => withLifecycleRead(snapshotAuthority.assert(snapshot).pipe(Effect.zipRight(operation)))

    return {
      prepareTurn: ({ sessionId, snapshot }) =>
        lifecycleGate.write(
          Effect.gen(function* () {
            yield* snapshotAuthority.set(sessionId, snapshot)
            yield* turnState.begin(sessionId, snapshot?.revision ?? null)
            if (!snapshot) return yield* state.disposeSession(sessionId)
            yield* state.discardSupersededSessionConnections(snapshot)
          }).pipe(
            // If turn preparation fails/dies/interrupts, settle the turn and dispose
            // the session so no stale "pending" turn or connection is left behind.
            Effect.onError(() =>
              snapshotAuthority.tombstone(sessionId).pipe(
                Effect.zipRight(turnState.complete(sessionId)),
                Effect.zipRight(clearPendingInvalidation(pendingInvalidations, sessionId)),
                Effect.zipRight(state.disposeSession(sessionId)),
                Effect.catchAllCause(() => Effect.void),
              ),
            ),
          ),
        ),
      completeTurn: ({ sessionId, nextSnapshot }) =>
        lifecycleGate.write(
          Effect.gen(function* () {
            yield* snapshotAuthority.set(sessionId, nextSnapshot)
            yield* turnState.complete(sessionId)
            if (yield* takePendingInvalidation(pendingInvalidations, sessionId)) {
              yield* state.invalidateSessionConnections(sessionId)
            }
            if (!nextSnapshot) return yield* state.disposeSession(sessionId)
            yield* state.discardSupersededSessionConnections(nextSnapshot)
          }),
        ),
      executeGateway: (input2) =>
        withAuthoritativeSnapshot(
          input2.snapshot,
          executeMcpGateway(
            state,
            input2.snapshot,
            input2.request,
            input2.signal,
            input2.interactions,
          ),
        ),
      listDirectTools: (snapshot) =>
        withAuthoritativeSnapshot(snapshot, listMcpDirectTools(state, snapshot)),
      browseCapabilities: (input2) =>
        withAuthoritativeSnapshot(
          input2.snapshot,
          browseMcpCapabilities(state, input2.snapshot, input2.serverInstanceId),
        ),
      getPrompt: (input2) =>
        withAuthoritativeSnapshot(input2.snapshot, getMcpPrompt({ ...input2, state })),
      readResource: (input2) =>
        withAuthoritativeSnapshot(input2.snapshot, readMcpResource({ ...input2, state })),
      reviewRemoteSkill: (input2) =>
        withAuthoritativeSnapshot(input2.snapshot, reviewMcpRemoteSkill({ ...input2, state })),
      callAppTool: (input2) =>
        withAuthoritativeSnapshot(input2.snapshot, callMcpAppTool({ ...input2, state })),
      operateTask: (input2) =>
        input2.snapshot
          ? withAuthoritativeSnapshot(
              input2.snapshot,
              operateMcpTask(state, input2.snapshot, input2.request),
            )
          : withLifecycleRead(operateMcpTask(state, null, input2.request)),
      setEventSubscription: (input2) =>
        withAuthoritativeSnapshot(input2.snapshot, state.setEventSubscription(input2)),
      getEvents: (sessionId) => withLifecycleRead(state.getEvents(sessionId)),
      getEventSubscriptions: (sessionId) =>
        withLifecycleRead(state.getEventSubscriptions(sessionId)),
      disposeSession: (sessionId) =>
        lifecycleGate.write(
          snapshotAuthority
            .tombstone(sessionId)
            .pipe(
              Effect.zipRight(turnState.complete(sessionId)),
              Effect.zipRight(clearPendingInvalidation(pendingInvalidations, sessionId)),
              Effect.zipRight(state.disposeSession(sessionId)),
            ),
        ),
      reconcileIdleConnections: () =>
        lifecycleGate.write(
          Effect.gen(function* () {
            const active = yield* turnState.activeSessions()
            yield* Ref.update(pendingInvalidations, (current) => new Set([...current, ...active]))
            yield* state.reconcileIdleConnections((namespace) => active.has(namespace))
          }),
        ),
      disposeAll: () =>
        lifecycleGate.write(
          snapshotAuthority
            .tombstoneAll()
            .pipe(
              Effect.zipRight(turnState.clear()),
              Effect.zipRight(Ref.set(pendingInvalidations, new Set())),
              Effect.zipRight(state.disposeAll()),
            ),
        ),
      getConnectionStatuses: () => withLifecycleRead(state.getConnectionStatuses()),
      getNotices: (sessionId) => withLifecycleRead(state.getNotices(sessionId)),
      doctor: () => runMcpRuntimeDoctor(),
    } satisfies McpRuntimeServiceShape
  })
}
