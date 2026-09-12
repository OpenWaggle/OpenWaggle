import type {
  McpEventSubscriptionState,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import {
  type McpRuntimeFailure,
  McpServerNotEnabled,
  toMcpRuntimeError,
} from '../../../ports/mcp-errors'
import {
  getRetainedMcpEvents,
  makeMcpEventRateLimiter,
  recordMcpEvent,
} from './runtime-event-inbox'
import type { ActiveEventSubscription, RuntimeStateContext } from './runtime-state-types'

function admitEventSubscriptionMutation(ctx: RuntimeStateContext, runtimeNamespace: string) {
  return Ref.modify(ctx.eventSubscriptionLifecycle, (current) => {
    const existing = current.namespaces.get(runtimeNamespace)
    if (existing && !existing.active) return [undefined, current] as const
    if (!existing && !current.acceptUnknownNamespaces) return [undefined, current] as const
    const admitted = existing ?? { active: true, generation: 0 }
    return [
      admitted.generation,
      {
        ...current,
        namespaces: new Map(current.namespaces).set(runtimeNamespace, admitted),
      },
    ] as const
  })
}

function eventSubscriptionLifecycleIsCurrent(
  ctx: RuntimeStateContext,
  runtimeNamespace: string,
  generation: number,
) {
  return Ref.get(ctx.eventSubscriptionLifecycle).pipe(
    Effect.map((current) => {
      const existing = current.namespaces.get(runtimeNamespace)
      return existing?.active === true && existing.generation === generation
    }),
  )
}

function acquireEventSubscriptionMutationLock(
  ctx: RuntimeStateContext,
  key: string,
  runtimeNamespace: string,
) {
  return Ref.modify(ctx.eventSubscriptionCells, (current) => {
    const existing = current.get(key)
    const cell = existing ?? {
      semaphore: Effect.unsafeMakeSemaphore(1),
      users: 0,
      generation: 0,
      runtimeNamespace,
      active: undefined,
    }
    const acquired = { ...cell, users: cell.users + 1 }
    return [{ semaphore: acquired.semaphore }, new Map(current).set(key, acquired)] as const
  })
}

function releaseEventSubscriptionMutationLock(
  ctx: RuntimeStateContext,
  key: string,
  acquired: { readonly semaphore: Effect.Semaphore },
) {
  return Ref.update(ctx.eventSubscriptionCells, (current) => {
    const existing = current.get(key)
    if (!existing || existing.semaphore !== acquired.semaphore) return current
    const next = new Map(current)
    if (existing.users === 1 && !existing.active) next.delete(key)
    else next.set(key, { ...existing, users: existing.users - 1 })
    return next
  })
}

function beginEventSubscriptionMutation(
  ctx: RuntimeStateContext,
  key: string,
  acquired: { readonly semaphore: Effect.Semaphore },
) {
  return Ref.modify(ctx.eventSubscriptionCells, (current) => {
    const existing = current.get(key)
    if (!existing || existing.semaphore !== acquired.semaphore) {
      return [undefined, current] as const
    }
    return [
      { active: existing.active, generation: existing.generation },
      new Map(current).set(key, { ...existing, active: undefined }),
    ] as const
  })
}

function publishEventSubscription(
  ctx: RuntimeStateContext,
  key: string,
  acquired: { readonly semaphore: Effect.Semaphore },
  generation: number,
  active: ActiveEventSubscription,
) {
  return Ref.modify(ctx.eventSubscriptionCells, (current) => {
    const existing = current.get(key)
    if (
      !existing ||
      existing.semaphore !== acquired.semaphore ||
      existing.generation !== generation
    ) {
      return [false, current] as const
    }
    return [true, new Map(current).set(key, { ...existing, active })] as const
  })
}

function eventSubscriptionGenerationIsCurrent(
  ctx: RuntimeStateContext,
  key: string,
  acquired: { readonly semaphore: Effect.Semaphore },
  generation: number,
) {
  return Ref.get(ctx.eventSubscriptionCells).pipe(
    Effect.map((current) => {
      const existing = current.get(key)
      return existing?.semaphore === acquired.semaphore && existing.generation === generation
    }),
  )
}

function retiredEventSubscriptionError() {
  return toMcpRuntimeError(
    'subscribeEvents',
    new Error('MCP Event Inbox subscription was retired before activation completed.'),
  )
}

function inactiveEventSubscriptionState(server: McpTurnSnapshotServer): McpEventSubscriptionState {
  return {
    serverInstanceId: server.instanceId,
    serverLabel: server.name,
    active: false,
    mode: 'inactive',
    resourceUris: [],
    detail: 'Event Inbox subscription stopped. Remote work may continue independently.',
  }
}

function withEventSubscriptionMutationLock<A, E, R>(
  ctx: RuntimeStateContext,
  key: string,
  runtimeNamespace: string,
  operation: (acquired: { readonly semaphore: Effect.Semaphore }) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    acquireEventSubscriptionMutationLock(ctx, key, runtimeNamespace),
    (entry) => operation(entry).pipe(entry.semaphore.withPermits(1)),
    (entry) => releaseEventSubscriptionMutationLock(ctx, key, entry),
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
    const runtimeNamespace = resolveMcpRuntimeNamespace(input.snapshot)
    const lifecycleGeneration = yield* admitEventSubscriptionMutation(ctx, runtimeNamespace)
    if (lifecycleGeneration === undefined) {
      return yield* Effect.fail(retiredEventSubscriptionError())
    }
    return yield* withEventSubscriptionMutationLock(ctx, key, runtimeNamespace, (acquired) =>
      Effect.gen(function* () {
        if (
          !(yield* eventSubscriptionLifecycleIsCurrent(ctx, runtimeNamespace, lifecycleGeneration))
        ) {
          return yield* Effect.fail(retiredEventSubscriptionError())
        }
        const mutation = yield* beginEventSubscriptionMutation(ctx, key, acquired)
        if (!mutation) {
          return yield* Effect.fail(
            toMcpRuntimeError(
              'subscribeEvents',
              new Error('MCP Event Inbox subscription state was retired unexpectedly.'),
            ),
          )
        }
        const currentSubscription = mutation.active
        if (currentSubscription) {
          yield* Effect.promise(() => currentSubscription.close().catch(() => undefined))
        }
        if (
          !(yield* eventSubscriptionLifecycleIsCurrent(ctx, runtimeNamespace, lifecycleGeneration))
        ) {
          return yield* Effect.fail(retiredEventSubscriptionError())
        }
        if (!input.enabled) {
          return inactiveEventSubscriptionState(server)
        }
        const connection = yield* ctx.connections.get(input.snapshot, server)
        const [lifecycleIsCurrent, subscriptionGenerationIsCurrent] = yield* Effect.all([
          eventSubscriptionLifecycleIsCurrent(ctx, runtimeNamespace, lifecycleGeneration),
          eventSubscriptionGenerationIsCurrent(ctx, key, acquired, mutation.generation),
        ])
        if (!lifecycleIsCurrent || !subscriptionGenerationIsCurrent) {
          yield* ctx.connections.closeIfCurrent(key, connection)
          return yield* Effect.fail(retiredEventSubscriptionError())
        }
        const runtime = yield* Effect.runtime<never>()
        const rateLimit = makeMcpEventRateLimiter()
        let acceptingEvents = true
        const subscription = yield* Effect.tryPromise({
          try: () =>
            connection.subscribeEvents({
              resourceUris: input.resourceUris,
              // Vendor sync callback: run the Ref update through the captured runtime.
              onEvent: (event) => {
                if (!acceptingEvents) return
                Effect.runSync(
                  recordMcpEvent(ctx, input.snapshot, server, event, rateLimit).pipe(
                    Effect.provide(runtime),
                  ),
                )
              },
            }),
          catch: (error) => {
            acceptingEvents = false
            return toMcpRuntimeError('subscribeEvents', error)
          },
        })
        const state: McpEventSubscriptionState = {
          serverInstanceId: server.instanceId,
          serverLabel: server.name,
          active: true,
          mode: subscription.mode,
          resourceUris: subscription.resourceUris,
          detail:
            subscription.mode === 'modern-listen'
              ? 'Modern subscriptions/listen is active. Events use a bounded local inbox; overload is summarized there.'
              : 'Legacy notifications and resource subscriptions are active. Events use the same bounded local inbox.',
        }
        let closePromise: Promise<void> | undefined
        const close = () => {
          acceptingEvents = false
          closePromise ??= Promise.resolve().then(() => subscription.close())
          return closePromise
        }
        const published = yield* publishEventSubscription(ctx, key, acquired, mutation.generation, {
          sessionId: input.snapshot.sessionId,
          state,
          close,
        })
        if (!published) {
          yield* Effect.promise(() => close().catch(() => undefined))
          yield* ctx.connections.closeIfCurrent(key, connection)
          return yield* Effect.fail(retiredEventSubscriptionError())
        }
        return state
      }),
    )
  })
}

export function getEvents(ctx: RuntimeStateContext, sessionId?: string | null) {
  return getRetainedMcpEvents(ctx, sessionId)
}

export function getEventSubscriptions(ctx: RuntimeStateContext, sessionId?: string | null) {
  return Ref.get(ctx.eventSubscriptionCells).pipe(
    Effect.map((current) => {
      const subscriptions = [...current.values()].flatMap((cell) =>
        cell.active ? [cell.active] : [],
      )
      return sessionId
        ? subscriptions.flatMap((subscription) =>
            subscription.sessionId === sessionId ? [subscription.state] : [],
          )
        : subscriptions.map((subscription) => subscription.state)
    }),
  )
}
