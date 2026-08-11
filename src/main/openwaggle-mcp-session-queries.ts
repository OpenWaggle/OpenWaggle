import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { hasAnyActiveRun } from './application/active-session-runs'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import { requireGrant, sessionAllowed, toolResult } from './openwaggle-mcp-server-policy'
import {
  DEFAULT_SESSION_PAGE_SIZE,
  MAX_SESSION_PAGE_SIZE,
  type OpenWaggleSessionTaskController,
  type SessionToolInput,
  sessionSummary,
} from './openwaggle-mcp-session-contract'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { runAppEffect } from './runtime'

export async function listSessions(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  input: SessionToolInput,
) {
  requireGrant(options, 'sessions:discover')
  const metadataBySession = new Map((await metadata.list()).map((item) => [item.sessionId, item]))
  const pageSize = input.limit ?? DEFAULT_SESSION_PAGE_SIZE
  let offset = input.cursor ?? 0
  const visibleSessions = []
  let exhausted = false
  while (visibleSessions.length < pageSize && !exhausted) {
    const batch = await runAppEffect(
      Effect.gen(function* () {
        const repository = yield* SessionProjectionRepository
        return yield* repository.listDetails(MAX_SESSION_PAGE_SIZE, offset)
      }),
    )
    if (batch.length < MAX_SESSION_PAGE_SIZE) exhausted = true
    let consumedBatch = 0
    for (const session of batch) {
      consumedBatch += 1
      offset += 1
      if (!sessionAllowed(options, session)) continue
      visibleSessions.push({
        ...sessionSummary(session),
        pinned: metadataBySession.get(session.id)?.pinned ?? false,
      })
      if (visibleSessions.length === pageSize) break
    }
    if (consumedBatch < batch.length) exhausted = false
  }
  return toolResult({ sessions: visibleSessions, nextCursor: exhausted ? undefined : offset })
}

export function readSession(session: SessionDetail, input: SessionToolInput) {
  const offset = input.cursor ?? 0
  const pageSize = input.limit ?? DEFAULT_SESSION_PAGE_SIZE
  return toolResult({
    session: sessionSummary(session),
    messages: session.messages.slice(offset, offset + pageSize),
    nextCursor: offset + pageSize < session.messages.length ? offset + pageSize : undefined,
  })
}

export async function sessionStatus(
  tasks: OpenWaggleSessionTaskController,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
) {
  const [control, sessionTasks] = await Promise.all([
    metadata.get(session.id),
    tasks.listForSession(session.id),
  ])
  return toolResult({
    session: sessionSummary(session),
    active: hasAnyActiveRun(session.id) || tasks.hasActiveSessionTask(session.id),
    tasks: sessionTasks,
    pinned: control?.pinned ?? false,
    delegationDepth: control?.depth ?? 0,
    ...(control?.handoff ? { handoff: control.handoff } : {}),
  })
}
