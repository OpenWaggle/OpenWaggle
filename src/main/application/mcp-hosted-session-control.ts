import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import type { OpenWaggleMcpServeOptions } from '../openwaggle-mcp-server-policy'
import { toolResult } from '../openwaggle-mcp-server-policy'
import {
  assertNotOrigin,
  DEFAULT_WAIT_MS,
  MAX_HANDOFF_SUMMARY_BYTES,
  MAX_WAIT_MS,
  type OpenWaggleSessionTaskController,
  type SessionToolInput,
} from '../openwaggle-mcp-session-contract'
import type { OpenWaggleMcpSessionMetadataStore } from '../openwaggle-mcp-session-metadata-store'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { runAppEffect } from '../runtime'
import { cancelSessionRuns, hasAnyActiveRun, waitForSessionRuns } from './active-session-runs'

/**
 * Hosted MCP Session Control use cases, expressed as Effect programs. These are
 * consumed with `yield*` and executed at the SDK tool boundary. The task
 * controller and metadata store are external Promise edges (task runtime / fs)
 * wrapped once via `Effect.promise`; project-session mutations run through the
 * shared app runtime via `runAppEffect`.
 */

function failInvalid(message: string) {
  return Effect.fail(new Error(message))
}

export function messageSession(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleSessionTaskController,
  session: SessionDetail,
  input: SessionToolInput,
  steer: boolean,
) {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => assertNotOrigin(options, session.id),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    const objective = input.objective?.trim()
    if (!objective) return yield* failInvalid(`${input.operation} requires objective.`)
    const projectPath = session.projectPath
    if (!projectPath) return yield* failInvalid('The target session has no project path.')
    if (steer) {
      cancelSessionRuns(session.id)
      yield* tasks.cancelSession(session.id)
      const timeoutMs = input.timeoutMs ?? MAX_WAIT_MS
      const [desktopIdle, hostedIdle] = yield* Effect.all(
        [
          Effect.promise(() => waitForSessionRuns(session.id, timeoutMs)),
          tasks.waitForSession(session.id, timeoutMs),
        ],
        { concurrency: 'unbounded' },
      )
      if (!desktopIdle || !hostedIdle) {
        return yield* failInvalid(
          `The target session did not stop within ${timeoutMs} ms, so the steering objective was not started. Wait for cancellation to finish, then retry steer.`,
        )
      }
    }
    const result = yield* tasks.start({ projectPath, sessionId: session.id, objective })
    return toolResult(result)
  })
}

export function waitForSession(
  tasks: OpenWaggleSessionTaskController,
  session: SessionDetail,
  input: SessionToolInput,
) {
  return Effect.gen(function* () {
    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_MS
    const [desktopIdle, hostedIdle] = yield* Effect.all(
      [
        Effect.promise(() => waitForSessionRuns(session.id, timeoutMs)),
        tasks.waitForSession(session.id, timeoutMs),
      ],
      { concurrency: 'unbounded' },
    )
    return toolResult({
      sessionId: session.id,
      completed: desktopIdle && hostedIdle,
      timedOut: !(desktopIdle && hostedIdle),
      active: hasAnyActiveRun(session.id) || tasks.hasActiveSessionTask(session.id),
    })
  })
}

export function interruptSession(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleSessionTaskController,
  session: SessionDetail,
) {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => assertNotOrigin(options, session.id),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    const desktopCancelled = cancelSessionRuns(session.id)
    const hostedCancelled = yield* tasks.cancelSession(session.id)
    return toolResult({
      sessionId: session.id,
      completed: true,
      desktopCancelled,
      hostedTasksCancelled: hostedCancelled,
    })
  })
}

export function handoffSession(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  input: SessionToolInput,
) {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => assertNotOrigin(options, session.id),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    const summary = input.handoffSummary?.trim()
    if (!summary) return yield* failInvalid('handoff requires handoffSummary.')
    if (Buffer.byteLength(summary, 'utf8') > MAX_HANDOFF_SUMMARY_BYTES) {
      return yield* failInvalid(`handoffSummary exceeds ${MAX_HANDOFF_SUMMARY_BYTES} UTF-8 bytes.`)
    }
    const value = yield* Effect.promise(() =>
      metadata.update(session.id, (current) => ({
        ...current,
        handoff: {
          summary,
          createdAt: Date.now(),
          createdByProfile: options.profile,
          ...(options.originSessionId ? { originSessionId: options.originSessionId } : {}),
        },
        updatedAt: Date.now(),
      })),
    )
    return toolResult({ sessionId: session.id, handoff: value.handoff, completed: true })
  })
}

export function organizeSession(
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  input: SessionToolInput,
) {
  return Effect.gen(function* () {
    if (input.operation === 'pin' || input.operation === 'unpin') {
      const pinned = input.operation === 'pin'
      yield* Effect.promise(() =>
        metadata.update(session.id, (current) => ({ ...current, pinned, updatedAt: Date.now() })),
      )
      return toolResult({
        operation: input.operation,
        sessionId: session.id,
        pinned,
        completed: true,
      })
    }
    // Project-session mutations run through the shared app runtime.
    yield* Effect.promise(() =>
      runAppEffect(
        Effect.gen(function* () {
          const sessions = yield* SessionProjectionRepository
          if (input.operation === 'rename') {
            if (!input.title?.trim()) throw new Error('rename requires a non-empty title.')
            yield* sessions.updateTitle(session.id, input.title.trim())
            return
          }
          if (input.operation === 'archive') {
            yield* sessions.archive(session.id)
            return
          }
          yield* sessions.unarchive(session.id)
        }),
      ),
    )
    return toolResult({ operation: input.operation, sessionId: session.id, completed: true })
  })
}
