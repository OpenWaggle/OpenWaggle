import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { hasAnyActiveRun } from './application/active-session-runs'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import {
  assertProjectAllowed,
  requireGrant,
  sessionAllowed,
  toolResult,
} from './openwaggle-mcp-server-policy'
import {
  DEFAULT_SESSION_PAGE_SIZE,
  MAX_SESSION_PAGE_SIZE,
  type OpenWaggleSessionTaskController,
  type SessionToolInput,
  sessionSummary,
} from './openwaggle-mcp-session-contract'
import type {
  OpenWaggleMcpSessionMetadataStore,
  SessionControlMetadata,
} from './openwaggle-mcp-session-metadata-store'
import { assertHostedSessionWorktreeProvenance } from './openwaggle-mcp-session-worktree'
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
      if (!(await hostedSessionAllowed(options, metadata, session))) continue
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

export async function loadHostedSession(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  sessionId: string,
  loadSession?: (sessionId: string) => Promise<SessionDetail>,
) {
  const load = loadSession ?? loadProjectedSession
  const session = await load(sessionId).catch(() => null)
  if (!session || !(await hostedSessionAllowed(options, metadata, session, load))) {
    throw new Error(`Session ${JSON.stringify(sessionId)} was not found in the granted scope.`)
  }
  return session
}

async function loadProjectedSession(sessionId: string) {
  const session = await runAppEffect(
    Effect.gen(function* () {
      const repository = yield* SessionProjectionRepository
      return yield* repository.getOptional(SessionId(sessionId))
    }),
  )
  if (!session) throw new Error(`Session ${JSON.stringify(sessionId)} was not found.`)
  return session
}

type LoadSession = (sessionId: string) => Promise<SessionDetail>

async function worktreeSessionAllowed(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  control: SessionControlMetadata | undefined,
  loadSession: LoadSession,
  visited: ReadonlySet<string>,
): Promise<boolean | undefined> {
  const worktree = control?.worktree
  if (!worktree || session.projectPath !== worktree.projectPath) return undefined
  const sourceSession = await loadSession(worktree.sourceSessionId).catch(() => null)
  if (sourceSession?.projectPath !== worktree.sourceProjectPath) return false
  const sourceAllowed = await hostedSessionAllowed(
    options,
    metadata,
    sourceSession,
    loadSession,
    visited,
  )
  if (!sourceAllowed) return false
  return assertHostedSessionWorktreeProvenance({
    sourceProjectPath: worktree.sourceProjectPath,
    sourceSessionId: worktree.sourceSessionId,
    projectPath: worktree.projectPath,
    branch: worktree.branch,
  }).then(
    () => true,
    () => false,
  )
}

async function ownedSessionAllowed(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  control: SessionControlMetadata | undefined,
  loadSession: LoadSession,
  visited: ReadonlySet<string>,
) {
  const owned = control?.ownedSession
  if (!owned || owned.profile !== options.profile || session.projectPath !== owned.projectPath) {
    return false
  }
  if (owned.sourceSessionId !== undefined || owned.sourceProjectPath !== undefined) {
    if (owned.sourceSessionId === undefined || owned.sourceProjectPath === undefined) return false
    const sourceSession = await loadSession(owned.sourceSessionId).catch(() => null)
    if (!sourceSession || sourceSession.projectPath !== owned.sourceProjectPath) return false
    return hostedSessionAllowed(options, metadata, sourceSession, loadSession, visited)
  }
  if (!owned.projectPath) return false
  if (options.workspaceRoots.length === 0) return false
  try {
    return assertProjectAllowed(options, owned.projectPath) === owned.projectPath
  } catch {
    return false
  }
}

async function hostedSessionAllowed(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  loadSession: LoadSession = loadProjectedSession,
  visited: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  if (sessionAllowed(options, session)) return true
  if (visited.has(session.id)) return false
  const control = await metadata.get(session.id)
  const nextVisited = new Set([...visited, session.id])
  const worktreeAllowed = await worktreeSessionAllowed(
    options,
    metadata,
    session,
    control,
    loadSession,
    nextVisited,
  )
  if (worktreeAllowed !== undefined) return worktreeAllowed
  return ownedSessionAllowed(options, metadata, session, control, loadSession, nextVisited)
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
