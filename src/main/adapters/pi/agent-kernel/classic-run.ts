import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { createAgentRunContextExtension } from '../agent-run-context-extension'
import { createDelegationSpecificationUpdateExtension } from '../delegation-specification-update-extension'
import { createOrchestrationUpdateExtension } from '../orchestration-update-extension'
import { createPeerAgentReportExtension } from '../peer-agent-report-extension'
import { buildPiRunNewMessages } from '../pi-run-result'
import { createRunAttributionExtension } from '../run-attribution-extension'
import { registerPiLiveRun } from './pi-live-run-registry'
import {
  createPiRunSessionRuntime,
  promptPiSession,
  runSubscribedPiOperation,
} from './run-lifecycle'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'
import { createSessionListener } from './session-listener'
import { captureTurnCheckpoint } from './turn-capture'

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
      readonly mcpExtensionFactory?: ExtensionFactory
      readonly sessionsExtensionFactory?: ExtensionFactory
    },
) {
  const projectPath = input.workingPath
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
    createRunAttributionExtension(input.runId),
    peerReports.factory,
    orchestrationUpdates.factory,
    specificationUpdates.factory,
    ...(input.sessionsExtensionFactory ? [input.sessionsExtensionFactory] : []),
    ...(input.mcpExtensionFactory ? [input.mcpExtensionFactory] : []),
    ...(input.sessionIdentityContext
      ? [
          createAgentRunContextExtension({
            sessionIdentityContext: input.sessionIdentityContext,
            ...(input.agentInstructions ? { agentInstructions: input.agentInstructions } : {}),
            ...(input.toolAllowlist ? { toolAllowlist: input.toolAllowlist } : {}),
          }),
        ]
      : []),
  ]
  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    runId: input.runId,
    modelReference: input.model,
    ...(input.runAuthorizationOverride
      ? { runAuthorizationOverride: input.runAuthorizationOverride }
      : {}),
    ...(input.authorityCallerId ? { authorityCallerId: input.authorityCallerId } : {}),
    payload: input.payload,
    signal: input.signal,
    onEvent: input.onEvent,
    skillToggles: input.skillToggles,
    skillAllowlist: input.skillAllowlist,
    enabledOpenWaggleExtensionPackages: input.enabledOpenWaggleExtensionPackages,
    enabledOpenWaggleExtensionPackagePaths: input.enabledOpenWaggleExtensionPackagePaths,
    recordOpenWaggleExtensionRuntimeFailure: input.recordOpenWaggleExtensionRuntimeFailure,
    ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
  })

  const unregisterLiveRun = registerPiLiveRun({ runId: input.runId, session, model })
  const unsubscribe = session.subscribe(createSessionListener(input, input.runId))
  const result = await runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi session cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi session cleanly',
    operation: () => promptPiSession(session, model, input.payload),
    buildErrorMessages: (appended) => buildPiRunNewMessages(input.payload, appended),
  }).finally(() => {
    peerReports.close()
    orchestrationUpdates.close()
    specificationUpdates.close()
    unregisterLiveRun()
  })

  // Best-effort per-turn checkpoint (WS7); never affects the run result.
  await captureTurnCheckpoint({ session: input.session, projectPath, runId: input.runId })

  return result
}
