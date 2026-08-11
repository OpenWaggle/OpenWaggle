import { Effect } from 'effect'
import type { McpRuntimeServiceShape } from '../../../ports/mcp-runtime-service'
import type { McpTurnStateServiceShape } from '../../../ports/mcp-turn-state-service'
import { makeMcpTurnState } from '../mcp-turn-state-service'
import { callMcpAppTool } from './app-tool-caller'
import { browseMcpCapabilities } from './capability-browser'
import { getMcpPrompt, operateMcpTask, readMcpResource } from './capability-operations'
import { listMcpDirectTools } from './direct-tools'
import { executeMcpGateway } from './gateway-executor'
import { reviewMcpRemoteSkill } from './remote-skills'
import type { McpRemoteTaskStore } from './remote-task-store'
import { runMcpRuntimeDoctor } from './runtime-doctor'
import { makeMcpRuntimeState } from './runtime-state'
import type { McpConnectionFactory } from './types'

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
export function makeMcpRuntimeService(input: {
  readonly connect: McpConnectionFactory
  readonly createHandleKey?: () => Buffer
  readonly remoteTaskStore?: McpRemoteTaskStore
  readonly turnState?: McpTurnStateServiceShape
}): Effect.Effect<McpRuntimeServiceShape> {
  return Effect.gen(function* () {
    const turnState = input.turnState ?? (yield* makeMcpTurnState())
    const state = yield* makeMcpRuntimeState(input)

    return {
      prepareTurn: ({ sessionId, snapshot }) =>
        Effect.gen(function* () {
          yield* turnState.begin(sessionId, snapshot?.revision ?? null)
          if (!snapshot) return yield* state.disposeSession(sessionId)
          yield* state.discardSupersededSessionConnections(snapshot)
        }).pipe(
          // If turn preparation fails/dies/interrupts, settle the turn and dispose
          // the session so no stale "pending" turn or connection is left behind.
          Effect.onError(() =>
            turnState.complete(sessionId).pipe(
              Effect.zipRight(state.disposeSession(sessionId)),
              Effect.catchAllCause(() => Effect.void),
            ),
          ),
        ),
      completeTurn: ({ sessionId, nextSnapshot }) =>
        Effect.gen(function* () {
          yield* turnState.complete(sessionId)
          if (!nextSnapshot) return yield* state.disposeSession(sessionId)
          yield* state.discardSupersededSessionConnections(nextSnapshot)
        }),
      executeGateway: (input2) =>
        executeMcpGateway(
          state,
          input2.snapshot,
          input2.request,
          input2.signal,
          input2.interactions,
        ),
      listDirectTools: (snapshot) => listMcpDirectTools(state, snapshot),
      browseCapabilities: (input2) =>
        browseMcpCapabilities(state, input2.snapshot, input2.serverInstanceId),
      getPrompt: (input2) => getMcpPrompt({ ...input2, state }),
      readResource: (input2) => readMcpResource({ ...input2, state }),
      reviewRemoteSkill: (input2) => reviewMcpRemoteSkill({ ...input2, state }),
      callAppTool: (input2) => callMcpAppTool({ ...input2, state }),
      operateTask: (input2) => operateMcpTask(state, input2.snapshot, input2.request),
      setEventSubscription: (input2) => state.setEventSubscription(input2),
      getEvents: (sessionId) => state.getEvents(sessionId),
      getEventSubscriptions: (sessionId) => state.getEventSubscriptions(sessionId),
      disposeSession: (sessionId) =>
        turnState.complete(sessionId).pipe(Effect.zipRight(state.disposeSession(sessionId))),
      reconcileIdleConnections: () =>
        turnState
          .activeSessions()
          .pipe(Effect.flatMap((active) => state.reconcileIdleConnections((ns) => active.has(ns)))),
      disposeAll: () => turnState.clear().pipe(Effect.zipRight(state.disposeAll())),
      getConnectionStatuses: () => state.getConnectionStatuses(),
      getNotices: (sessionId) => state.getNotices(sessionId),
      doctor: () => runMcpRuntimeDoctor(),
    } satisfies McpRuntimeServiceShape
  })
}
