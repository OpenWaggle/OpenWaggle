import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import { canonicalizeExistingProjectPath, toolResult } from './openwaggle-mcp-server-policy'
import {
  derivedDepth,
  type OpenWaggleSessionToolAdapters,
  type SessionToolInput,
  sessionSummary,
  worktreePlan,
} from './openwaggle-mcp-session-contract'
import type {
  HostedDerivedWorktreeMetadata,
  HostedSessionWorktreePlanMetadata,
  OpenWaggleMcpSessionMetadataStore,
  SessionControlMetadata,
} from './openwaggle-mcp-session-metadata-store'
import { AgentKernelService } from './ports/agent-kernel-service'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { runAppEffect } from './runtime'

type MaterializedWorktree = Awaited<
  ReturnType<OpenWaggleSessionToolAdapters['materializeWorktree']>
>

interface WorktreeDerivationContext {
  readonly adapters: OpenWaggleSessionToolAdapters
  readonly input: SessionToolInput
  readonly metadata: OpenWaggleMcpSessionMetadataStore
  readonly options: OpenWaggleMcpServeOptions
  readonly session: SessionDetail
  readonly sourceProjectPath: string
}

function resolveWorktreePlan(current: SessionControlMetadata | undefined, input: SessionToolInput) {
  const requestedPlan = worktreePlan(input)
  const plan =
    input.baseRef !== undefined || input.startFromOrigin !== undefined
      ? requestedPlan
      : (current?.worktreePlan ?? requestedPlan)
  const existing = current?.derivedWorktree
  if (
    existing &&
    (existing.requestedBaseRef !== plan.baseRef ||
      existing.startFromOrigin !== plan.startFromOrigin)
  ) {
    throw new Error(
      'This session already has a materialized hosted worktree. Its base ref and origin policy cannot be changed; create a new source session instead.',
    )
  }
  return { existing, plan }
}

async function loadExistingDerivedSession(
  sessionId: string,
  adapters: OpenWaggleSessionToolAdapters,
) {
  if (adapters.loadSession) return adapters.loadSession(sessionId)
  return runAppEffect(
    Effect.gen(function* () {
      const sessions = yield* SessionProjectionRepository
      return yield* sessions.get(SessionId(sessionId))
    }),
  )
}

async function findOrCreateSessionAtProjectPath(projectPath: string, title?: string) {
  return runAppEffect(
    Effect.gen(function* () {
      const sessions = yield* SessionProjectionRepository
      const existing = (yield* sessions.listDetails()).find(
        (candidate) => candidate.projectPath === projectPath,
      )
      if (existing) return existing
      const kernel = yield* AgentKernelService
      const runtimeSession = yield* kernel.createSession({ projectPath })
      const created = yield* sessions.create({
        projectPath,
        piSessionId: runtimeSession.piSessionId,
        piSessionFile: runtimeSession.piSessionFile,
      })
      if (title?.trim()) yield* sessions.updateTitle(created.id, title.trim())
      return yield* sessions.get(created.id)
    }),
  )
}

async function cleanupFailedWorktree(
  adapters: OpenWaggleSessionToolAdapters,
  worktree: MaterializedWorktree,
) {
  if (!worktree.created || !adapters.removeWorktree) return null
  try {
    await adapters.removeWorktree(worktree)
    return null
  } catch (error) {
    return error
  }
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function loadVerifiedDerivedSession(
  existing: HostedDerivedWorktreeMetadata,
  worktree: MaterializedWorktree,
  adapters: OpenWaggleSessionToolAdapters,
) {
  if (
    existing.projectPath !== worktree.projectPath ||
    existing.branch !== worktree.branch ||
    existing.baseRef !== worktree.baseRef
  ) {
    throw new Error(
      'The materialized hosted worktree no longer matches its durable session metadata. Repair or remove the residual worktree before retrying.',
    )
  }
  const derivedSession = await loadExistingDerivedSession(existing.sessionId, adapters)
  if (derivedSession.projectPath !== existing.projectPath) {
    throw new Error(
      `Derived session ${JSON.stringify(existing.sessionId)} no longer points at its recorded hosted worktree.`,
    )
  }
  return derivedSession
}

async function createDerivedSession(
  input: SessionToolInput,
  worktree: MaterializedWorktree,
  adapters: OpenWaggleSessionToolAdapters,
) {
  try {
    return adapters.createSessionAtProjectPath
      ? await adapters.createSessionAtProjectPath({
          projectPath: worktree.projectPath,
          ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        })
      : await findOrCreateSessionAtProjectPath(worktree.projectPath, input.title)
  } catch (error) {
    const cleanupError = await cleanupFailedWorktree(adapters, worktree)
    if (cleanupError) {
      throw new Error(
        `Creating the hosted worktree session failed: ${describeError(error)}. Cleanup also failed; inspect ${worktree.projectPath} and branch ${worktree.branch}: ${describeError(cleanupError)}.`,
        { cause: error },
      )
    }
    throw error
  }
}

function resolveDerivedSession(
  existing: HostedDerivedWorktreeMetadata | undefined,
  input: SessionToolInput,
  worktree: MaterializedWorktree,
  adapters: OpenWaggleSessionToolAdapters,
) {
  return existing
    ? loadVerifiedDerivedSession(existing, worktree, adapters)
    : createDerivedSession(input, worktree, adapters)
}

async function persistWorktreeProvenance(
  context: WorktreeDerivationContext,
  plan: HostedSessionWorktreePlanMetadata,
  worktree: MaterializedWorktree,
  derivedSession: SessionDetail,
  depth: number,
) {
  const createdAt = Date.now()
  try {
    await context.metadata.update(derivedSession.id, (value) => ({
      ...value,
      depth,
      worktree: {
        sourceSessionId: context.session.id,
        sourceProjectPath: context.sourceProjectPath,
        projectPath: worktree.projectPath,
        branch: worktree.branch,
        baseRef: worktree.baseRef,
        requestedBaseRef: plan.baseRef,
        startFromOrigin: plan.startFromOrigin,
        createdAt,
      },
      updatedAt: createdAt,
    }))
    await context.metadata.update(context.session.id, (value) => ({
      ...value,
      derivedWorktree: {
        sessionId: derivedSession.id,
        projectPath: worktree.projectPath,
        branch: worktree.branch,
        baseRef: worktree.baseRef,
        requestedBaseRef: plan.baseRef,
        startFromOrigin: plan.startFromOrigin,
        createdAt,
      },
      updatedAt: createdAt,
    }))
  } catch (error) {
    throw new Error(
      `The hosted worktree and derived session ${JSON.stringify(derivedSession.id)} exist, but OpenWaggle could not persist all provenance metadata. They were retained for safe retry; retry create-worktree before using ${worktree.projectPath}. Cause: ${describeError(error)}.`,
      { cause: error },
    )
  }
}

async function materializeDerivedWorktree(context: WorktreeDerivationContext) {
  const current = await context.metadata.get(context.session.id)
  const { existing, plan } = resolveWorktreePlan(current, context.input)
  const depth = await derivedDepth(context.options, context.metadata, context.session.id)
  await context.metadata.update(context.session.id, (value) => ({
    ...value,
    worktreePlan: plan,
    updatedAt: Date.now(),
  }))
  const worktree = await context.adapters.materializeWorktree({
    sourceProjectPath: context.sourceProjectPath,
    sourceSessionId: context.session.id,
    ...(existing ? { baseRef: existing.baseRef, startFromOrigin: false } : plan),
  })
  const derivedSession = await resolveDerivedSession(
    existing,
    context.input,
    worktree,
    context.adapters,
  )
  await persistWorktreeProvenance(context, plan, worktree, derivedSession, depth)
  return toolResult({
    sourceSessionId: context.session.id,
    derivedSessionId: derivedSession.id,
    session: sessionSummary(derivedSession),
    worktree: {
      projectPath: worktree.projectPath,
      branch: worktree.branch,
      baseRef: worktree.baseRef,
    },
    delegationDepth: depth,
    completed: true,
  })
}

export async function createWorktree(
  options: OpenWaggleMcpServeOptions,
  metadata: OpenWaggleMcpSessionMetadataStore,
  session: SessionDetail,
  input: SessionToolInput,
  adapters: OpenWaggleSessionToolAdapters,
) {
  if (!session.projectPath) throw new Error('The source session has no project path.')
  const sourceProjectPath = canonicalizeExistingProjectPath(session.projectPath)
  return metadata.withSessionWorktreeLock(session.id, () =>
    materializeDerivedWorktree({
      adapters,
      input,
      metadata,
      options,
      session,
      sourceProjectPath,
    }),
  )
}
