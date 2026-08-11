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

export { createWorktree } from './openwaggle-mcp-session-derivation'

import { AgentKernelService } from './ports/agent-kernel-service'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { runAppEffect } from './runtime'

export async function createSession(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  input: SessionToolInput,
) {
  if (!input.projectPath) throw new Error('create requires projectPath.')
  if (options.workspaceRoots.length === 0) {
    throw new Error('Creating a session requires an explicit --workspace grant.')
  }
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
        return yield* sessions.get(created.id)
      }),
    ),
  ])
  await metadata.update(session.id, (current) => ({
    ...current,
    depth,
    ownedSession: {
      profile: options.profile,
      projectPath: session.projectPath,
      createdAt: Date.now(),
    },
    updatedAt: Date.now(),
  }))
  return toolResult({ session: sessionSummary(session), delegationDepth: depth })
}

export async function planWorktree(
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  input: SessionToolInput,
) {
  const plan = worktreePlan(input)
  if (!session.projectPath) throw new Error('The source session has no project path.')
  await metadata.withSessionWorktreeLock(session.id, async () => {
    const current = await metadata.get(session.id)
    if (
      current?.derivedWorktree &&
      (current.derivedWorktree.requestedBaseRef !== plan.baseRef ||
        current.derivedWorktree.startFromOrigin !== plan.startFromOrigin)
    ) {
      throw new Error(
        'This session already has a materialized hosted worktree. Its base ref and origin policy cannot be changed; create a new source session instead.',
      )
    }
    await metadata.update(session.id, (value) => ({
      ...value,
      worktreePlan: plan,
      updatedAt: Date.now(),
    }))
  })
  return toolResult({ sessionId: session.id, sourceProjectPath: session.projectPath, plan })
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
    derivedDepth(options, metadata, session.id),
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
  await metadata.update(copiedSession.id, (current) => ({
    ...current,
    depth,
    ownedSession: {
      profile: options.profile,
      projectPath: copiedSession.projectPath,
      sourceSessionId: session.id,
      sourceProjectPath: session.projectPath,
      createdAt: Date.now(),
    },
    updatedAt: Date.now(),
  }))
  return toolResult({
    cancelled: false,
    session: sessionSummary(copiedSession),
    delegationDepth: depth,
    ...(editorText ? { editorText } : {}),
  })
}
