/**
 * WaggleRunService — application-layer coordination for waggle mode execution.
 *
 * Waggle runs are Pi-native turns over the same canonical Pi session as standard
 * mode. This service owns product-shell semantics (validation, branch/run state,
 * stream forwarding, persistence) and delegates turn sequencing to Pi-native
 * Waggle package logic through AgentKernelService.
 */

import { safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  isInheritedWaggleModelBinding,
  type WaggleConfig,
  type WaggleStreamMetadata,
  type WaggleTurnEvent,
} from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { makeErrorInfo } from '../agent/error-classifier'
import { FileConflictTracker } from '../agent/file-conflict-tracker'
import { createLogger } from '../logger'
import type { AgentKernelRunResult } from '../ports/agent-kernel-service'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import {
  appendDurableAgentLoopEvents,
  type DurableAgentLoopEvent,
  isDurableAgentLoopEvent,
} from './agent-run/agent-loop-events'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from './extension-runtime-service'
import { assignSessionTitleFromUserText, hydratePayloadAttachments } from './run-handler-utils'
import { extractFilePath } from './waggle-run/metadata'
import { persistWaggleSnapshot } from './waggle-run/persistence'
import {
  clearDurableWaggleActiveRun,
  recordDurableWaggleRun,
  resolveWaggleBranchId,
  type WaggleActiveRunIdentity,
} from './waggle-run/runtime-state'

const logger = createLogger('waggle-run-service')

export interface WaggleRunInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly model: SupportedModelId
  readonly config: WaggleConfig
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly onRunPrepared?: (runtimeModel: SupportedModelId) => void
  readonly onTitleAssigned?: (title: string) => void
}

interface PreparedWaggleRun {
  readonly assignedTitle?: string
  readonly hydratedPayload: HydratedAgentSendPayload
  readonly inheritedModel: SupportedModelId
  readonly runtimeModel: SupportedModelId
  readonly session: SessionDetail
  readonly skillToggles: Record<string, boolean> | undefined
  readonly enabledOpenWaggleExtensionPackagePaths: readonly string[]
}

function validationErrorOutcome() {
  return {
    outcome: 'validation-error' as const,
    message: 'Invalid Waggle mode configuration',
    code: 'validation-error',
  }
}

function notFoundOutcome() {
  const errorInfo = makeErrorInfo('session-not-found', 'Session not found')
  return {
    outcome: 'not-found' as const,
    message: errorInfo.userMessage,
    code: errorInfo.code,
  }
}

function noProjectOutcome() {
  return {
    outcome: 'no-project' as const,
    message: 'Please select a project folder before starting Waggle mode.',
    code: 'no-project',
  }
}

function noInheritedModelOutcome() {
  return {
    outcome: 'validation-error' as const,
    message: 'Select a model before starting Waggle mode.',
    code: 'validation-error',
  }
}

function resolveInitialWaggleRuntimeModel(input: {
  readonly config: WaggleConfig
  readonly selectedModel: SupportedModelId
}): SupportedModelId {
  const firstAgentModel = input.config.agents[0].model
  return isInheritedWaggleModelBinding(firstAgentModel)
    ? input.selectedModel
    : SupportedModelId(firstAgentModel)
}

function configRequiresInheritedModel(config: WaggleConfig) {
  return config.agents.some((agent) => isInheritedWaggleModelBinding(agent.model))
}

function prepareWaggleRun(input: WaggleRunInput) {
  return Effect.gen(function* () {
    if (!safeDecodeUnknown(waggleConfigSchema, input.config).success) {
      return { ok: false as const, outcome: validationErrorOutcome() }
    }
    if (configRequiresInheritedModel(input.config) && !input.model.trim()) {
      return { ok: false as const, outcome: noInheritedModelOutcome() }
    }

    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(input.sessionId)
    if (!session) return { ok: false as const, outcome: notFoundOutcome() }
    if (!session.projectPath) return { ok: false as const, outcome: noProjectOutcome() }

    const assignedTitle = yield* assignPreparedTitle(input, session)
    const hydratedPayload: HydratedAgentSendPayload = {
      ...input.payload,
      attachments: yield* Effect.promise(() =>
        hydratePayloadAttachments(input.payload.attachments),
      ),
    }
    const enabledOpenWaggleExtensionPackagePaths =
      yield* listRuntimeEnabledOpenWaggleExtensionPackagePaths(session.projectPath)

    return {
      ok: true as const,
      value: {
        assignedTitle,
        hydratedPayload,
        inheritedModel: input.model,
        runtimeModel: resolveInitialWaggleRuntimeModel({
          config: input.config,
          selectedModel: input.model,
        }),
        session,
        skillToggles: settings.skillTogglesByProject[session.projectPath],
        enabledOpenWaggleExtensionPackagePaths,
      },
    }
  })
}

function assignPreparedTitle(input: WaggleRunInput, session: SessionDetail) {
  return Effect.gen(function* () {
    const title = yield* assignSessionTitleFromUserText(
      input.sessionId,
      session,
      input.payload.text,
    )
    if (title) yield* Effect.sync(() => input.onTitleAssigned?.(title))
    return title ?? undefined
  })
}

function runPreparedWaggle(
  input: WaggleRunInput,
  prepared: PreparedWaggleRun,
  setActiveRunIdentity: (identity: WaggleActiveRunIdentity) => void,
) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    const initialTree = yield* sessionRepo.getTree(SessionId(String(input.sessionId)))
    const branchId = resolveWaggleBranchId({ sessionId: input.sessionId, tree: initialTree })

    yield* recordDurableWaggleRun({
      branchId,
      run: input,
      runtimeModel: prepared.runtimeModel,
      sessionRepo,
    })
    setActiveRunIdentity({ sessionId: input.sessionId, runId: input.runId })
    yield* Effect.sync(() => input.onRunPrepared?.(prepared.runtimeModel))
    logWaggleStart(input)

    const conflictTracker = new FileConflictTracker()
    const durableAgentLoopEvents: DurableAgentLoopEvent[] = []
    const agentKernel = yield* AgentKernelService
    const result = yield* agentKernel.run({
      session: prepared.session,
      runId: input.runId,
      payload: prepared.hydratedPayload,
      model: prepared.runtimeModel,
      signal: input.signal,
      skillToggles: prepared.skillToggles,
      enabledOpenWaggleExtensionPackagePaths: prepared.enabledOpenWaggleExtensionPackagePaths,
      onEvent: () => undefined,
      waggle: {
        config: input.config,
        inheritedModel: prepared.inheritedModel,
        onWaggleEvent: (event, meta) => {
          if (isDurableAgentLoopEvent(event)) {
            durableAgentLoopEvents.push(event)
          }
          input.onEvent(event, meta)
          if (event.type !== 'tool_execution_end') return
          if (event.toolName !== 'write' && event.toolName !== 'edit') return

          const filePath = extractFilePath(event.args)
          if (!filePath) return

          const warning = conflictTracker.recordModification(
            filePath,
            meta.agentIndex,
            input.config.agents,
            meta.turnNumber,
          )
          if (warning) input.onTurnEvent({ type: 'file-conflict', warning })
        },
        onTurnEvent: input.onTurnEvent,
      },
    })

    const existingTree = yield* sessionRepo.getTree(input.sessionId)
    const sessionSnapshot = appendDurableAgentLoopEvents({
      snapshot: result.sessionSnapshot,
      events: durableAgentLoopEvents,
      runId: input.runId,
      existingNodes: existingTree?.nodes ?? [],
    })

    yield* persistWaggleSnapshot({
      sessionId: input.sessionId,
      result,
      snapshot: sessionSnapshot,
      waggleConfig: input.config,
    })

    if (result.aborted || input.signal.aborted) {
      input.onTurnEvent({ type: 'collaboration-stopped', reason: 'User cancelled' })
      return {
        outcome: 'aborted' as const,
        ...(prepared.assignedTitle ? { assignedTitle: prepared.assignedTitle } : {}),
      }
    }

    return successOutcome(input, prepared, result)
  })
}

function logWaggleStart(input: WaggleRunInput) {
  logger.info('Starting Pi-native Waggle collaboration', {
    sessionId: input.sessionId,
    agents: input.config.agents.map((agent) => agent.label),
    maxTurns: input.config.stop.maxTurnsSafety,
    stopCondition: input.config.stop.primary,
  })
}

function successOutcome(
  input: WaggleRunInput,
  prepared: PreparedWaggleRun,
  result: AgentKernelRunResult,
) {
  logger.info('Pi-native Waggle collaboration finished', {
    sessionId: input.sessionId,
    aborted: result.aborted ?? false,
    terminalError: result.terminalError ?? null,
    assistantMessages: result.newMessages.filter((message) => message.role === 'assistant').length,
  })

  return {
    outcome: 'success' as const,
    newMessages: result.newMessages,
    ...(result.terminalError ? { lastError: result.terminalError } : {}),
    ...(prepared.assignedTitle ? { assignedTitle: prepared.assignedTitle } : {}),
  }
}

export function executeWaggleRun(input: WaggleRunInput) {
  let activeRunIdentity: WaggleActiveRunIdentity | null = null

  return Effect.gen(function* () {
    const prepared = yield* prepareWaggleRun(input)
    if (!prepared.ok) return prepared.outcome
    return yield* runPreparedWaggle(input, prepared.value, (identity) => {
      activeRunIdentity = identity
    })
  }).pipe(Effect.ensuring(clearDurableWaggleActiveRun(() => activeRunIdentity)))
}
