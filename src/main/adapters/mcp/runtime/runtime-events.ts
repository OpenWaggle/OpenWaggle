import { randomUUID } from 'node:crypto'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpEventRecord,
  McpEventSubscriptionState,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { Clock, Effect, Ref } from 'effect'
import {
  type McpRuntimeFailure,
  McpServerNotEnabled,
  toMcpRuntimeError,
} from '../../../ports/mcp-errors'
import type { RuntimeStateContext } from './runtime-state-types'
import type { McpClientConnection } from './types'

function addEvent(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  event: Parameters<Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent']>[0],
) {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((receivedAt) =>
      Ref.update(ctx.events, (current) => {
        const existing = current.get(snapshot.sessionId) ?? []
        const next: McpEventRecord = {
          id: randomUUID(),
          sessionId: snapshot.sessionId,
          serverInstanceId: server.instanceId,
          serverLabel: server.name,
          kind: event.kind,
          receivedAt,
          payload: event.payload,
          read: false,
        }
        return new Map(current).set(
          snapshot.sessionId,
          [...existing, next].slice(-MCP_CONFIG.MAX_EVENT_INBOX_ITEMS),
        )
      }),
    ),
  )
}

export function setEventSubscription(
  ctx: RuntimeStateContext,
  input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly enabled: boolean
    readonly resourceUris: readonly string[]
  },
): Effect.Effect<McpEventSubscriptionState, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const server = input.snapshot.servers.find(
      (candidate) => candidate.instanceId === input.serverInstanceId,
    )
    if (!server)
      return yield* Effect.fail(
        new McpServerNotEnabled({
          serverInstanceId: input.serverInstanceId,
          message: 'The requested MCP server is not enabled in this turn snapshot.',
        }),
      )
    const key = ctx.connections.key(input.snapshot, server)
    const current = (yield* Ref.get(ctx.eventSubscriptions)).get(key)
    if (current) {
      yield* Ref.update(ctx.eventSubscriptions, (subs) => {
        const next = new Map(subs)
        next.delete(key)
        return next
      })
      yield* Effect.promise(() => current.close().catch(() => undefined))
    }
    if (!input.enabled) {
      return {
        serverInstanceId: server.instanceId,
        serverLabel: server.name,
        active: false,
        mode: 'inactive',
        resourceUris: [],
        detail: 'Event Inbox subscription stopped. Remote work may continue independently.',
      }
    }
    const connection = yield* ctx.connections.get(input.snapshot, server)
    const runtime = yield* Effect.runtime<never>()
    const subscription = yield* Effect.tryPromise({
      try: () =>
        connection.subscribeEvents({
          resourceUris: input.resourceUris,
          // Vendor sync callback: run the Ref update through the captured runtime.
          onEvent: (event) =>
            Effect.runSync(
              addEvent(ctx, input.snapshot, server, event).pipe(Effect.provide(runtime)),
            ),
        }),
      catch: (error) => toMcpRuntimeError('subscribeEvents', error),
    })
    const state: McpEventSubscriptionState = {
      serverInstanceId: server.instanceId,
      serverLabel: server.name,
      active: true,
      mode: subscription.mode,
      resourceUris: subscription.resourceUris,
      detail:
        subscription.mode === 'modern-listen'
          ? 'Modern subscriptions/listen is active. Events stay in the inbox until selected.'
          : 'Legacy notifications and explicit resource subscriptions are active.',
    }
    yield* Ref.update(ctx.eventSubscriptions, (subs) =>
      new Map(subs).set(key, {
        sessionId: input.snapshot.sessionId,
        state,
        close: subscription.close,
      }),
    )
    return state
  })
}

export function getEvents(ctx: RuntimeStateContext, sessionId?: string | null) {
  return Ref.get(ctx.events).pipe(
    Effect.map((current) =>
      sessionId ? (current.get(sessionId) ?? []) : [...current.values()].flat(),
    ),
  )
}

export function getEventSubscriptions(ctx: RuntimeStateContext, sessionId?: string | null) {
  return Ref.get(ctx.eventSubscriptions).pipe(
    Effect.map((current) => {
      const subscriptions = [...current.values()]
      return sessionId
        ? subscriptions.flatMap((subscription) =>
            subscription.sessionId === sessionId ? [subscription.state] : [],
          )
        : subscriptions.map((subscription) => subscription.state)
    }),
  )
}
