import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import {
  cloneAgentSessionToNewSession,
  forkAgentSessionToNewSession,
} from './application/agent-session-service'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import { assertProjectAllowed, toolResult } from './openwaggle-mcp-server-policy'
import {
  assertNotOrigin,
  derivedDepth,
  type OpenWaggleSessionTaskController,
  type OpenWaggleSessionToolAdapters,
  type SessionToolInput,
  sessionSummary,
  worktreePlan,
} from './openwaggle-mcp-session-contract'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import { AgentKernelService } from './ports/agent-kernel-service'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { runAppEffect } from './runtime'

export async function createSession(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  input: SessionToolInput,
) {
  if (!input.projectPath) throw new Error('create requires projectPath.')
  const resolvedProjectPath = assertProjectAllowed(options, input.projectPath)
  const [depth, session] = await Promise.all([
    derivedDepth(options, metadata),
    runAppEffect(
      Effect.gen(function* () {
        const kernel = yield* AgentKernelService
        const runtimeSession = yield* kernel.createSession({ projectPath: resolvedProjectPath })
        const sessions = yield* SessionProjectionRepository
        const created = yield* sessions.create({
          projectPath: resolvedProjectPath,
          piSessionId: runtimeSession.piSessionId,
          piSessionFile: runtimeSession.piSessionFile,
        })
        if (input.title?.trim()) yield* sessions.updateTitle(created.id, input.title.trim())
        if (input.environmentMode) yield* sessions.setWorktreePlan(created.id, worktreePlan(input))
        return yield* sessions.get(created.id)
      }),
    ),
  ])
  await metadata.setDepth(session.id, depth)
  return toolResult({ session: sessionSummary(session), delegationDepth: depth })
}

export async function planWorktree(session: SessionDetail, input: SessionToolInput) {
  const plan = worktreePlan(input)
  await runAppEffect(
    Effect.gen(function* () {
      const sessions = yield* SessionProjectionRepository
      yield* sessions.setWorktreePlan(session.id, plan)
    }),
  )
  return toolResult({ sessionId: session.id, plan, completed: true })
}

export async function createWorktree(
  session: SessionDetail,
  input: SessionToolInput,
  adapters: OpenWaggleSessionToolAdapters,
) {
  if (input.environmentMode && input.environmentMode !== 'worktree') {
    throw new Error('create-worktree only accepts environmentMode="worktree".')
  }
  if (input.environmentMode) await planWorktree(session, input)
  const refreshed = adapters.reloadSession
    ? await adapters.reloadSession(session.id)
    : await runAppEffect(
        Effect.gen(function* () {
          const sessions = yield* SessionProjectionRepository
          return yield* sessions.get(session.id)
        }),
      )
  if (refreshed.environmentMode !== 'worktree') {
    throw new Error('create-worktree requires a worktree-mode plan.')
  }
  const worktreePath = await adapters.materializeWorktree(refreshed)
  return toolResult({ sessionId: session.id, worktreePath, completed: true })
}

export async function copySession(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleSessionTaskController,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  input: SessionToolInput,
  adapters: OpenWaggleSessionToolAdapters,
) {
  assertNotOrigin(options, session.id)
  const targetNodeId = input.targetNodeId?.trim() || session.messages.at(-1)?.id
  if (!targetNodeId)
    throw new Error(`${input.operation} requires targetNodeId on an empty session.`)
  const [depth, profile] = await Promise.all([
    derivedDepth(options, metadata),
    tasks.getExecutionProfile(session.id),
  ])
  const operation = input.operation === 'fork' ? 'fork' : 'clone'
  const copyInput = {
    operation,
    sessionId: SessionId(session.id),
    targetNodeId: SessionNodeId(String(targetNodeId)),
    model: SupportedModelId(profile.model),
  } as const
  const result = adapters.copySession
    ? await adapters.copySession(copyInput)
    : await runAppEffect(
        (operation === 'fork' ? forkAgentSessionToNewSession : cloneAgentSessionToNewSession)(
          copyInput,
        ),
      )
  const copiedSession = 'session' in result ? result.session : undefined
  if (result.cancelled || !copiedSession) return toolResult({ cancelled: true })
  const editorText = 'editorText' in result ? result.editorText : undefined
  await metadata.setDepth(copiedSession.id, depth)
  return toolResult({
    cancelled: false,
    session: sessionSummary(copiedSession),
    delegationDepth: depth,
    ...(editorText ? { editorText } : {}),
  })
}
