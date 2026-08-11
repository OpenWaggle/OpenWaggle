import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import {
  cancelSessionRuns,
  hasAnyActiveRun,
  waitForSessionRuns,
} from './application/active-session-runs'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import { toolResult } from './openwaggle-mcp-server-policy'
import {
  assertNotOrigin,
  DEFAULT_WAIT_MS,
  MAX_HANDOFF_SUMMARY_BYTES,
  MAX_WAIT_MS,
  type OpenWaggleSessionTaskController,
  type SessionToolInput,
} from './openwaggle-mcp-session-contract'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { runAppEffect } from './runtime'

export async function messageSession(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleSessionTaskController,
  session: SessionDetail,
  input: SessionToolInput,
  steer: boolean,
) {
  assertNotOrigin(options, session.id)
  if (!input.objective?.trim()) throw new Error(`${input.operation} requires objective.`)
  if (!session.projectPath) throw new Error('The target session has no project path.')
  if (steer) {
    cancelSessionRuns(session.id)
    await tasks.cancelSession(session.id)
    const timeoutMs = input.timeoutMs ?? MAX_WAIT_MS
    const [desktopIdle, hostedIdle] = await Promise.all([
      waitForSessionRuns(session.id, timeoutMs),
      tasks.waitForSession(session.id, timeoutMs),
    ])
    if (!desktopIdle || !hostedIdle) {
      throw new Error(
        `The target session did not stop within ${timeoutMs} ms, so the steering objective was not started. Wait for cancellation to finish, then retry steer.`,
      )
    }
  }
  return toolResult(
    await tasks.start({
      projectPath: session.projectPath,
      sessionId: session.id,
      objective: input.objective.trim(),
    }),
  )
}

export async function waitForSession(
  tasks: OpenWaggleSessionTaskController,
  session: SessionDetail,
  input: SessionToolInput,
) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_MS
  const [desktopIdle, hostedIdle] = await Promise.all([
    waitForSessionRuns(session.id, timeoutMs),
    tasks.waitForSession(session.id, timeoutMs),
  ])
  return toolResult({
    sessionId: session.id,
    completed: desktopIdle && hostedIdle,
    timedOut: !(desktopIdle && hostedIdle),
    active: hasAnyActiveRun(session.id) || tasks.hasActiveSessionTask(session.id),
  })
}

export async function interruptSession(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleSessionTaskController,
  session: SessionDetail,
) {
  assertNotOrigin(options, session.id)
  const desktopCancelled = cancelSessionRuns(session.id)
  const hostedCancelled = await tasks.cancelSession(session.id)
  return toolResult({
    sessionId: session.id,
    completed: true,
    desktopCancelled,
    hostedTasksCancelled: hostedCancelled,
  })
}

export async function handoffSession(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  input: SessionToolInput,
) {
  assertNotOrigin(options, session.id)
  const summary = input.handoffSummary?.trim()
  if (!summary) throw new Error('handoff requires handoffSummary.')
  if (Buffer.byteLength(summary, 'utf8') > MAX_HANDOFF_SUMMARY_BYTES) {
    throw new Error(`handoffSummary exceeds ${MAX_HANDOFF_SUMMARY_BYTES} UTF-8 bytes.`)
  }
  const value = await metadata.update(session.id, (current) => ({
    ...current,
    handoff: {
      summary,
      createdAt: Date.now(),
      createdByProfile: options.profile,
      ...(options.originSessionId ? { originSessionId: options.originSessionId } : {}),
    },
    updatedAt: Date.now(),
  }))
  return toolResult({ sessionId: session.id, handoff: value.handoff, completed: true })
}

export async function organizeSession(
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  input: SessionToolInput,
) {
  if (input.operation === 'pin' || input.operation === 'unpin') {
    const pinned = input.operation === 'pin'
    await metadata.update(session.id, (current) => ({ ...current, pinned, updatedAt: Date.now() }))
    return toolResult({
      operation: input.operation,
      sessionId: session.id,
      pinned,
      completed: true,
    })
  }
  await runAppEffect(
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
  )
  return toolResult({ operation: input.operation, sessionId: session.id, completed: true })
}
