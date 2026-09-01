import type { WaggleInvocation } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { executeAgentRun } from '../application/agent-run-service'
import { explicitWaggleTerminalResult } from '../application/explicit-waggle-command-result'
import { runRegisteredExplicitWaggle } from '../application/explicit-waggle-command-runner'
import type { WaggleExecutionContext } from '../application/waggle-run-execution-context'
import { AgentRequestedWaggleService } from '../ports/agent-requested-waggle-service'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import type { SessionControlRunExecutionInput } from '../ports/session-control-run-executor'
import { SessionOrchestrationUpdateRepository } from '../ports/session-orchestration-update-repository'
import { SessionReportRepository } from '../ports/session-report-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import {
  markOrchestrationUpdatesDelivered,
  markReportsDelivered,
  markSpecificationUpdatesDelivered,
} from './session-control-run-context-delivery'
import { publishRunFailure } from './session-control-run-result'
import {
  narrowRunAuthorization,
  type ResolvedSessionRunExecution,
} from './session-run-execution-profile'

interface RegisteredRunInput {
  readonly request: SessionControlRunExecutionInput
  readonly execution: ResolvedSessionRunExecution
  readonly controller: AbortController
  readonly allowModelMultiAgent: boolean
}

type RegisteredRunContext = Effect.Effect.Success<ReturnType<typeof loadRegisteredRunContext>>

function loadRegisteredRunContext(input: RegisteredRunInput) {
  return Effect.gen(function* () {
    const attachments = yield* SessionControlAttachmentService
    const requestedWaggle = yield* AgentRequestedWaggleService
    const orchestration = yield* SessionOrchestrationUpdateRepository
    const reports = yield* SessionReportRepository
    const resolvedAttachments = yield* attachments.resolve({
      attachmentIds: input.request.intent.attachmentIds,
      sessionId: input.request.sessionId,
      ownerCallerId: input.request.intent.callerId,
    })
    return {
      requestedWaggle,
      orchestration,
      reports,
      resolvedAttachments,
      preparedAttachments: resolvedAttachments.map(
        ({ source: _source, ...attachment }) => attachment,
      ),
      pendingReports: yield* reports.listPending({ targetSessionId: input.request.sessionId }),
      pendingOrchestration: yield* orchestration.listPending({
        parentSessionId: input.request.sessionId,
      }),
      pendingSpecifications: yield* orchestration.listPendingSpecifications({
        workerSessionId: input.request.sessionId,
      }),
    }
  })
}

function executionContext(
  input: RegisteredRunInput,
  context: RegisteredRunContext,
): WaggleExecutionContext {
  return {
    runAuthorizationOverride: narrowRunAuthorization(
      input.request.intent.runAuthorizationOverride,
      input.execution.authorizationCeiling,
    ),
    authorityCallerId: input.request.intent.callerId,
    agentInstructions: input.execution.agentInstructions,
    sessionIdentityContext: input.execution.identityContext,
    peerAgentReports: context.pendingReports,
    onPeerAgentReportsDelivered: (reportIds) => {
      markReportsDelivered(context.reports, input.request, reportIds)
    },
    orchestrationUpdates: context.pendingOrchestration,
    onOrchestrationUpdatesDelivered: (updateIds) => {
      markOrchestrationUpdatesDelivered(context.orchestration, input.request, updateIds)
    },
    delegationSpecificationUpdates: context.pendingSpecifications,
    onDelegationSpecificationUpdatesDelivered: (updateIds) => {
      markSpecificationUpdatesDelivered(context.orchestration, input.request, updateIds)
    },
    toolAllowlist: input.execution.toolAllowlist,
    skillAllowlist: input.execution.skillAllowlist,
    mcpServerAllowlist: input.execution.mcpServerAllowlist,
    sessionCapabilities: input.execution.sessionCapabilities,
    modelMultiAgentEnabled: input.allowModelMultiAgent,
  }
}

function runQueuedWaggle(
  input: RegisteredRunInput,
  context: RegisteredRunContext,
  waggle: WaggleInvocation,
) {
  return Effect.map(
    runRegisteredExplicitWaggle({
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      payload: {
        text: input.request.intent.text,
        thinkingLevel: input.request.intent.thinkingLevel ?? input.execution.thinkingLevel,
        attachments: context.preparedAttachments,
        waggle,
        ...(input.request.intent.visualizationContext
          ? { visualizationContext: input.request.intent.visualizationContext }
          : {}),
      },
      model: input.execution.model,
      config: waggle.config,
      abortController: input.controller,
      ...executionContext(input, context),
    }),
    (result) => ({ mode: 'waggle' as const, result: explicitWaggleTerminalResult(result) }),
  )
}

function runClassic(input: RegisteredRunInput, context: RegisteredRunContext) {
  return Effect.gen(function* () {
    const result = yield* executeAgentRun({
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      model: input.execution.model,
      payload: {
        text: input.request.intent.text,
        thinkingLevel: input.request.intent.thinkingLevel ?? input.execution.thinkingLevel,
        attachments: context.preparedAttachments,
        ...(input.request.intent.visualizationContext
          ? { visualizationContext: input.request.intent.visualizationContext }
          : {}),
      },
      hydratedAttachments: context.resolvedAttachments,
      ...executionContext(input, context),
      signal: input.controller.signal,
      onEvent: (event) => {
        publishSessionHostEvent({
          kind: 'session-transport',
          sessionId: input.request.sessionId,
          event,
        })
      },
      onTitleAssigned: () => {
        publishSessionHostEvent({
          kind: 'session-list-changed',
          sessionId: input.request.sessionId,
          change: 'updated',
        })
      },
    })
    if (
      result.outcome === 'invalid-model' ||
      result.outcome === 'not-found' ||
      result.outcome === 'error'
    ) {
      publishRunFailure(input.request, result)
    }
    if (result.outcome === 'success') {
      yield* context.requestedWaggle.runIfRequested({
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        messages: result.newMessages,
        model: input.execution.model,
        thinkingLevel: input.request.intent.thinkingLevel ?? input.execution.thinkingLevel,
        controller: input.controller,
      })
    }
    return { mode: 'classic' as const, result }
  })
}

export function executeRegisteredRun(input: RegisteredRunInput) {
  return Effect.gen(function* () {
    const context = yield* loadRegisteredRunContext(input)
    const waggle = input.request.intent.waggle
    return yield* waggle ? runQueuedWaggle(input, context, waggle) : runClassic(input, context)
  })
}
