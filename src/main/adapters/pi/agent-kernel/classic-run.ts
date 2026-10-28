import type { ExtensionFactory, InlineExtension } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import {
  agentRunContextAllowlists,
  createAgentRunContextExtension,
  createAgentToolAllowlistGuard,
} from '../agent-run-context-extension'
import { createDelegationSpecificationUpdateExtension } from '../delegation-specification-update-extension'
import { createOrchestrationUpdateExtension } from '../orchestration-update-extension'
import { createPeerAgentReportExtension } from '../peer-agent-report-extension'
import { buildPiRunNewMessages } from '../pi-run-result'
import { notePiRunForUsageStatistics } from '../pi-usage-statistics'
import { createRunAttributionExtension } from '../run-attribution-extension'
import { piEntryNodeIds } from './pi-entry-node-ids'
import { registerPiLiveRun } from './pi-live-run-registry'
import { piResponseUsageInput } from './pi-response-usage'
import {
  createPiRunSessionRuntime,
  promptPiSession,
  runSubscribedPiOperation,
} from './run-lifecycle'
import { observeRunWorkspaceMutations } from './run-workspace-mutations'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'
import { createSessionListener } from './session-listener'
import { captureTurnCheckpoint, piSessionFileOf } from './turn-capture'

function sessionDirectories(input: {
  readonly visualizationDirectory?: string
  readonly scratchDirectory?: string
}) {
  return {
    ...(input.visualizationDirectory
      ? { visualizationDirectory: input.visualizationDirectory }
      : {}),
    ...(input.scratchDirectory ? { scratchDirectory: input.scratchDirectory } : {}),
  }
}

function runtimeResources(
  input: {
    readonly preparedEnvironment?: AgentKernelRunInput['preparedEnvironment']
    readonly trustedExtensionFactories?: readonly ExtensionFactory[]
    readonly systemPromptAppendices?: readonly string[]
  },
  extensionFactories: readonly InlineExtension[],
) {
  return {
    ...(input.preparedEnvironment ? { preparedEnvironment: input.preparedEnvironment } : {}),
    extensionFactories: [...extensionFactories],
    ...(input.trustedExtensionFactories
      ? { trustedExtensionFactories: [...input.trustedExtensionFactories] }
      : {}),
    ...(input.systemPromptAppendices
      ? { systemPromptAppendices: [...input.systemPromptAppendices] }
      : {}),
  }
}

/** What a classic Run's inline extensions read from its input. */
export type ClassicRunExtensionInput = Pick<
  AgentKernelRunInput,
  | 'runId'
  | 'peerAgentReports'
  | 'onPeerAgentReportsDelivered'
  | 'orchestrationUpdates'
  | 'onOrchestrationUpdatesDelivered'
  | 'delegationSpecificationUpdates'
  | 'onDelegationSpecificationUpdatesDelivered'
  | 'sessionIdentityContext'
  | 'runIdentityContext'
  | 'agentInstructions'
  | 'toolAllowlist'
  | 'mcpServerAllowlist'
> & {
  readonly sessionsExtensionFactory?: ExtensionFactory
  readonly extensionFactories?: readonly InlineExtension[]
}

/**
 * The inline extensions of a classic Run, in the order Pi loads them, and the call that closes
 * their delivery queues. The first-turn prefix budget (scripts/perf/first-turn-prefix) composes its
 * Run with this function too, so an extension added here is measured against the budget.
 */
export function classicRunInlineExtensions(input: ClassicRunExtensionInput) {
  const peerReports = createPeerAgentReportExtension({
    runId: input.runId,
    pendingReports: input.peerAgentReports ?? [],
    onDelivered: input.onPeerAgentReportsDelivered ?? (() => {}),
  })
  const orchestrationUpdates = createOrchestrationUpdateExtension({
    runId: input.runId,
    pendingUpdates: input.orchestrationUpdates ?? [],
    onDelivered: input.onOrchestrationUpdatesDelivered ?? (() => {}),
  })
  const specificationUpdates = createDelegationSpecificationUpdateExtension({
    runId: input.runId,
    pendingUpdates: input.delegationSpecificationUpdates ?? [],
    onDelivered: input.onDelegationSpecificationUpdatesDelivered ?? (() => {}),
  })
  const extensionFactories = [
    // First of the Run's inline extensions, so a refused call never reaches OpenWaggle's approval.
    createAgentToolAllowlistGuard(agentRunContextAllowlists(input)),
    createRunAttributionExtension(input.runId),
    peerReports.factory,
    orchestrationUpdates.factory,
    specificationUpdates.factory,
    input.sessionsExtensionFactory,
    ...(input.extensionFactories ?? []),
    ...(input.sessionIdentityContext
      ? [
          createAgentRunContextExtension({
            sessionIdentityContext: input.sessionIdentityContext,
            ...(input.runIdentityContext ? { runIdentityContext: input.runIdentityContext } : {}),
            ...(input.agentInstructions ? { agentInstructions: input.agentInstructions } : {}),
            ...agentRunContextAllowlists(input),
          }),
        ]
      : []),
  ].filter((factory): factory is InlineExtension => factory !== undefined)
  return {
    extensionFactories,
    close: () => {
      peerReports.close()
      orchestrationUpdates.close()
      specificationUpdates.close()
    },
  }
}

/**
 * Runs a classic (non-Waggle) Pi turn.
 *
 * `workingPath` is the tree this turn runs in, already resolved (and, for a worktree-mode
 * session, already born) by the caller. It is passed in rather than re-derived because
 * worktree birth is not idempotent against a stale in-memory session: it persists the new
 * path with SQL but does not mutate the `SessionDetail` it was given, so a second call would
 * still see `worktreePath` as null and try to create the same worktree twice - which fails,
 * because the directory now exists and the branch is already checked out there.
 */
export async function runPiSession(
  input: AgentKernelRunInput &
    PiRuntimeExtensionIsolationInput & {
      readonly workingPath: string
      readonly visualizationDirectory?: string
      readonly scratchDirectory?: string
      readonly sessionsExtensionFactory?: ExtensionFactory
      readonly extensionFactories?: readonly InlineExtension[]
      readonly trustedExtensionFactories?: readonly ExtensionFactory[]
      readonly systemPromptAppendices?: readonly string[]
    },
) {
  const startedAt = Date.now()
  const projectPath = input.workingPath
  const inline = classicRunInlineExtensions(input)
  const { extensionFactories } = inline
  const { model, session } = await createPiRunSessionRuntime({
    // The Session's own selection may continue on its last answering model (as Pi resumes).
    modelFallback: 'last-answering-model',
    session: input.session,
    projectPath,
    runId: input.runId,
    modelReference: input.model,
    ...(input.runAuthorizationOverride
      ? { runAuthorizationOverride: input.runAuthorizationOverride }
      : {}),
    ...(input.authorityCallerId ? { authorityCallerId: input.authorityCallerId } : {}),
    compactionThresholdPercent: input.compactionThresholdPercent,
    payload: input.payload,
    signal: input.signal,
    onEvent: input.onEvent,
    ...(input.onControlAvailable ? { onControlAvailable: input.onControlAvailable } : {}),
    skillToggles: input.skillToggles,
    skillAllowlist: input.skillAllowlist,
    enabledOpenWaggleExtensionPackages: input.enabledOpenWaggleExtensionPackages,
    enabledOpenWaggleExtensionPackagePaths: input.enabledOpenWaggleExtensionPackagePaths,
    ...sessionDirectories(input),
    recordOpenWaggleExtensionRuntimeFailure: input.recordOpenWaggleExtensionRuntimeFailure,
    ...runtimeResources(input, extensionFactories),
  })

  notePiRunForUsageStatistics(input, model, session)
  const unregisterLiveRun = registerPiLiveRun({
    runId: input.runId,
    session,
    model,
    signal: input.signal,
  })
  const unsubscribe = session.subscribe(
    createSessionListener(
      {
        ...input,
        sessionEntries: session.sessionManager,
        nodeIds: piEntryNodeIds(input.session),
        ...piResponseUsageInput(session),
      },
      input.runId,
    ),
  )
  const workspaceMutations = observeRunWorkspaceMutations(session, input.payload.text)
  const result = await runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi session cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi session cleanly',
    operation: () => promptPiSession(session, model, input.payload, input.scheduledTask),
    buildErrorMessages: (appended) => buildPiRunNewMessages(input.payload, appended),
  }).finally(() => {
    inline.close()
    unregisterLiveRun()
    workspaceMutations.dispose()
  })

  // Best-effort per-turn checkpoint (WS7); never affects the run result.
  await captureTurnCheckpoint({
    session: input.session,
    projectPath,
    runId: input.runId,
    startedAt,
    ...piSessionFileOf(session),
    workspaceMayHaveChanged: workspaceMutations.mayHaveChangedWorkspace(),
  })

  return result
}
