import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleInvocation } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import type { AgentRunResult } from '../application/agent-run/types'
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
import { publishRunFailure, publishRunStartFailure } from './session-control-run-result'
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

/**
 * Tracks the event that tells clients a Run has ended: Pi's last `agent_end` that is not followed
 * by an automatic retry. Its time is when the Run was seen to end, which decides whether a
 * Follow-up accepted meanwhile is an explicit retry (see `planRunSettlement`).
 */
function trackTerminalEvent() {
  let terminal: { readonly at: number; readonly failed: boolean } | undefined
  return {
    observe(event: AgentTransportEvent) {
      if (event.type !== 'agent_end' || event.willRetry) return
      terminal = { at: Date.now(), failed: event.reason === 'error' }
    },
    get current() {
      return terminal
    },
  }
}

/**
 * Ends a Run that failed, publishing its terminal event exactly once. When Pi (or the kernel) has
 * already published the failure there is nothing to add; publishing it again sent clients a
 * second `agent_end`. When no terminal event went out, as when the Run never reached Pi, the
 * Host publishes it. A failure found after a clean `agent_end`, such as the turn failing to save,
 * is returned for the settlement to report instead.
 */
function endFailedRun(
  request: SessionControlRunExecutionInput,
  result: Extract<AgentRunResult, { outcome: 'error' | 'invalid-model' | 'not-found' }>,
  terminal: ReturnType<typeof trackTerminalEvent>,
) {
  const ended = terminal.current
  if (!ended) {
    publishRunFailure(request, result)
    return { terminalEventAt: Date.now() }
  }
  return ended.failed
    ? { terminalEventAt: ended.at }
    : { terminalEventAt: ended.at, failure: { code: result.code } }
}

function runQueuedWaggle(
  input: RegisteredRunInput,
  context: RegisteredRunContext,
  waggle: WaggleInvocation,
) {
  const payload = {
    text: input.request.intent.text,
    attachments: context.preparedAttachments,
    waggle,
    ...(input.request.intent.visualizationContext
      ? { visualizationContext: input.request.intent.visualizationContext }
      : {}),
  }
  return Effect.map(
    runRegisteredExplicitWaggle({
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      payload,
      model: input.execution.model,
      config: waggle.config,
      abortController: input.controller,
      hydratedAttachments: context.resolvedAttachments,
      ...executionContext(input, context),
    }),
    (result) => ({
      mode: 'waggle' as const,
      result: explicitWaggleTerminalResult(result),
      resourceResult: result,
      payload,
      // The Waggle runner publishes the Run's single agent_end just before it returns.
      terminalEventAt: Date.now(),
    }),
  )
}

function runClassic(input: RegisteredRunInput, context: RegisteredRunContext) {
  return Effect.gen(function* () {
    const payload = {
      text: input.request.intent.text,
      attachments: context.preparedAttachments,
      ...(input.request.intent.visualizationContext
        ? { visualizationContext: input.request.intent.visualizationContext }
        : {}),
    }
    let didReportWorktreeLaunch = false
    const terminal = trackTerminalEvent()
    const result = yield* executeAgentRun({
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      model: input.execution.model,
      payload,
      hydratedAttachments: context.resolvedAttachments,
      ...executionContext(input, context),
      signal: input.controller.signal,
      onEvent: (event) => {
        terminal.observe(event)
        publishSessionHostEvent({
          kind: 'session-transport',
          sessionId: input.request.sessionId,
          event,
        })
      },
      onWorktreeLaunch: (progress) => {
        didReportWorktreeLaunch = true
        publishSessionHostEvent({
          kind: 'session-worktree-launch',
          sessionId: input.request.sessionId,
          model: input.execution.model,
          mode: 'classic',
          event: { type: 'progress', progress },
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
    let ending: {
      readonly terminalEventAt?: number
      readonly failure?: { readonly code: string }
    } = terminal.current ? { terminalEventAt: terminal.current.at } : {}
    if (
      result.outcome === 'invalid-model' ||
      result.outcome === 'not-found' ||
      result.outcome === 'error'
    ) {
      if (didReportWorktreeLaunch) {
        publishSessionHostEvent({
          kind: 'session-worktree-launch',
          sessionId: input.request.sessionId,
          model: input.execution.model,
          mode: 'classic',
          event: { type: 'failure', errorMessage: result.message },
        })
      }
      ending = endFailedRun(input.request, result, terminal)
    }
    if (result.outcome === 'success') {
      const {
        peerAgentReports: _reports,
        onPeerAgentReportsDelivered: _reportsDelivered,
        orchestrationUpdates: _updates,
        onOrchestrationUpdatesDelivered: _updatesDelivered,
        delegationSpecificationUpdates: _specifications,
        onDelegationSpecificationUpdatesDelivered: _specificationsDelivered,
        ...authority
      } = executionContext(input, context)
      yield* context.requestedWaggle.runIfRequested({
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        messages: result.newMessages,
        model: input.execution.model,
        controller: input.controller,
        // The classic Run already delivered its reports and updates; the Waggle inherits only
        // who it acts for and what it may do.
        authority,
      })
    }
    return { mode: 'classic' as const, result, resourceResult: result, payload, ...ending }
  })
}

export function executeRegisteredRun(input: RegisteredRunInput) {
  return Effect.gen(function* () {
    const context = yield* loadRegisteredRunContext(input).pipe(
      Effect.tapError((error) => Effect.sync(() => publishRunStartFailure(input.request, error))),
    )
    const waggle = input.request.intent.waggle
    return yield* waggle ? runQueuedWaggle(input, context, waggle) : runClassic(input, context)
  })
}
