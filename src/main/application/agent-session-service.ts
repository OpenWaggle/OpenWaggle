import { SessionId, type SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import {
  type AgentKernelForkPosition,
  type AgentKernelNavigateTreeResult,
  AgentKernelService,
  type AgentKernelSessionSnapshot,
  isAgentKernelMissingEntryError,
} from '../ports/agent-kernel-service'
import { ProviderService } from '../ports/provider-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from './extension-runtime-service'
import { attributeCopiedVisualizationSources } from './inline-visualization-ownership'

export { attributeCopiedVisualizationSources } from './inline-visualization-ownership'

const logger = createLogger('agent-session-service')

type NavigateTreeOutcome =
  | { readonly type: 'success'; readonly result: AgentKernelNavigateTreeResult }
  | { readonly type: 'missing-entry' }

export interface AgentSessionCommandInput {
  readonly sessionId: SessionId
  readonly model: SupportedModelId
}

export interface AgentSessionCompactInput extends AgentSessionCommandInput {
  readonly customInstructions?: string
  readonly signal?: AbortSignal
  readonly onEvent?: (event: AgentTransportEvent) => void
}

export interface AgentSessionNavigateTreeInput extends AgentSessionCommandInput {
  readonly targetNodeId: SessionNodeId
  readonly summarize?: boolean
  readonly customInstructions?: string
}

export interface AgentSessionForkInput extends AgentSessionCommandInput {
  readonly targetNodeId: SessionNodeId
}

interface AgentSessionCopyInput extends AgentSessionForkInput {
  readonly position: AgentKernelForkPosition
}

interface KernelSnapshotResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
}

function loadSessionForCommand(input: AgentSessionCommandInput) {
  return Effect.gen(function* () {
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(input.sessionId)
    if (!session) {
      return yield* Effect.fail(new Error('Session not found'))
    }

    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(input.model, session.projectPath)
    if (!isKnown) {
      return yield* Effect.fail(new Error(`Unknown model: ${input.model}`))
    }

    return session
  })
}

function loadValidatedAgentSession(input: AgentSessionCommandInput) {
  return Effect.gen(function* () {
    const session = yield* loadSessionForCommand(input)
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = session.projectPath
      ? settings.skillTogglesByProject[session.projectPath]
      : undefined
    const enabledOpenWaggleExtensionPackagePaths = session.projectPath
      ? yield* listRuntimeEnabledOpenWaggleExtensionPackagePaths(session.projectPath)
      : undefined
    return {
      session,
      compactionThresholdPercent: settings.compactionThresholdPercent,
      ...(skillToggles ? { skillToggles } : {}),
      ...(enabledOpenWaggleExtensionPackagePaths ? { enabledOpenWaggleExtensionPackagePaths } : {}),
    }
  })
}

function persistKernelSnapshot(sessionId: SessionId, result: KernelSnapshotResult) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(sessionId)),
      nodes: result.sessionSnapshot.nodes,
      activeNodeId: result.sessionSnapshot.activeNodeId,
      piSessionId: result.piSessionId,
      piSessionFile: result.piSessionFile,
    })
  })
}

export function getAgentContextUsage(input: AgentSessionCommandInput) {
  return Effect.gen(function* () {
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(input.sessionId)
    if (!session) {
      return null
    }

    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(input.model, session.projectPath)
    if (!isKnown) {
      return null
    }

    const agentKernel = yield* AgentKernelService
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = session.projectPath
      ? settings.skillTogglesByProject[session.projectPath]
      : undefined
    const enabledOpenWaggleExtensionPackagePaths = session.projectPath
      ? yield* listRuntimeEnabledOpenWaggleExtensionPackagePaths(session.projectPath)
      : undefined
    return yield* agentKernel.getContextUsage({
      session,
      model: input.model,
      compactionThresholdPercent: settings.compactionThresholdPercent,
      ...(skillToggles ? { skillToggles } : {}),
      ...(enabledOpenWaggleExtensionPackagePaths ? { enabledOpenWaggleExtensionPackagePaths } : {}),
    })
  })
}

function copyAgentSessionToNewSession(input: AgentSessionCopyInput) {
  return Effect.gen(function* () {
    const {
      session,
      compactionThresholdPercent,
      skillToggles,
      enabledOpenWaggleExtensionPackagePaths,
    } = yield* loadValidatedAgentSession(input)

    if (!session.projectPath) {
      return yield* Effect.fail(new Error('No project path set on the session.'))
    }

    const agentKernel = yield* AgentKernelService
    const sessionRepo = yield* SessionRepository
    const sourceTree = yield* sessionRepo.getTree(input.sessionId)
    if (!sourceTree) {
      return yield* Effect.fail(new Error('Session tree not found'))
    }
    const result = yield* agentKernel.forkSession({
      session,
      model: input.model,
      compactionThresholdPercent,
      targetNodeId: String(input.targetNodeId),
      position: input.position,
      ...(skillToggles ? { skillToggles } : {}),
      ...(enabledOpenWaggleExtensionPackagePaths ? { enabledOpenWaggleExtensionPackagePaths } : {}),
    })

    if (result.cancelled) {
      return { cancelled: true }
    }

    const sessionProjectionRepo = yield* SessionProjectionRepository
    /*
     * The fork inherits the source session's isolation.
     *
     * Omitting it defaulted the copy to local mode, so a fork of a worktree-mode session ran in the
     * user's opened checkout - the agent editing exactly the tree worktree mode exists to protect -
     * and the context row that would have shown it is hidden for a fork, because it only appears
     * before the first message. The copy gets its own worktree at its own deterministic path on the
     * first send; nothing is shared with the session it came from.
     */
    const createdProjection = yield* sessionProjectionRepo.create({
      projectPath: session.projectPath,
      piSessionId: result.piSessionId,
      piSessionFile: result.piSessionFile,
      // A fork inherits both: this branch's environment mode, and main's authorization mode.
      ...(session.environmentMode ? { environmentMode: session.environmentMode } : {}),
      authorizationMode: session.authorizationMode,
    })

    yield* persistKernelSnapshot(SessionId(String(createdProjection.id)), {
      ...result,
      sessionSnapshot: attributeCopiedVisualizationSources(result.sessionSnapshot, {
        id: session.id,
        nodes: sourceTree.nodes,
      }),
    })

    const persistedSession = yield* sessionProjectionRepo.get(
      SessionId(String(createdProjection.id)),
    )
    return {
      session: persistedSession,
      cancelled: false,
      ...(result.editorText ? { editorText: result.editorText } : {}),
    }
  })
}

export function forkAgentSessionToNewSession(input: AgentSessionForkInput) {
  return copyAgentSessionToNewSession({ ...input, position: 'before' })
}

export function cloneAgentSessionToNewSession(input: AgentSessionForkInput) {
  return copyAgentSessionToNewSession({ ...input, position: 'at' })
}

export function compactAgentSession(input: AgentSessionCompactInput) {
  return Effect.gen(function* () {
    const {
      session,
      compactionThresholdPercent,
      skillToggles,
      enabledOpenWaggleExtensionPackagePaths,
    } = yield* loadValidatedAgentSession(input)
    const agentKernel = yield* AgentKernelService
    const result = yield* agentKernel.compact({
      session,
      model: input.model,
      compactionThresholdPercent,
      customInstructions: input.customInstructions,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      ...(skillToggles ? { skillToggles } : {}),
      ...(enabledOpenWaggleExtensionPackagePaths ? { enabledOpenWaggleExtensionPackagePaths } : {}),
    })

    yield* persistKernelSnapshot(input.sessionId, result)

    return {
      summary: result.summary,
      firstKeptEntryId: result.firstKeptEntryId,
      tokensBefore: result.tokensBefore,
    }
  })
}

export function navigateAgentSessionTree(input: AgentSessionNavigateTreeInput) {
  return Effect.gen(function* () {
    const {
      session,
      compactionThresholdPercent,
      skillToggles,
      enabledOpenWaggleExtensionPackagePaths,
    } = yield* loadValidatedAgentSession(input)
    const agentKernel = yield* AgentKernelService
    const navigation = yield* agentKernel
      .navigateTree({
        session,
        model: input.model,
        compactionThresholdPercent,
        targetNodeId: String(input.targetNodeId),
        summarize: input.summarize,
        customInstructions: input.customInstructions,
        ...(skillToggles ? { skillToggles } : {}),
        ...(enabledOpenWaggleExtensionPackagePaths
          ? { enabledOpenWaggleExtensionPackagePaths }
          : {}),
      })
      .pipe(
        Effect.map(
          (result): NavigateTreeOutcome => ({
            type: 'success',
            result,
          }),
        ),
        Effect.catchAll((error) => {
          if (isAgentKernelMissingEntryError(error)) {
            logger.warn('Skipped Pi tree navigation because the target entry is absent', {
              sessionId: String(input.sessionId),
              targetNodeId: String(input.targetNodeId),
            })
            return Effect.succeed<NavigateTreeOutcome>({ type: 'missing-entry' })
          }

          return Effect.fail(error)
        }),
      )

    if (navigation.type === 'missing-entry') {
      return { cancelled: true }
    }

    const { result } = navigation
    yield* persistKernelSnapshot(input.sessionId, result)

    return {
      editorText: result.editorText,
      cancelled: result.cancelled,
    }
  })
}
