import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../../ports/agent-kernel-service'
import { createAgentRunContextExtension } from '../agent-run-context-extension'
import { createDelegationSpecificationUpdateExtension } from '../delegation-specification-update-extension'
import { createOrchestrationUpdateExtension } from '../orchestration-update-extension'
import { createPeerAgentReportExtension } from '../peer-agent-report-extension'
import { createRunAttributionExtension } from '../run-attribution-extension'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'

export type PiWaggleKernelRunInput = AgentKernelRunInput & {
  readonly waggle: AgentKernelWaggleRunOptions
  /**
   * The tree this turn runs in, already resolved (and born, for a worktree-mode session) by
   * the caller. Passed in rather than re-derived: worktree birth persists the new path with
   * SQL without mutating the `SessionDetail` it was given, so calling it twice would try to
   * create the same worktree again and fail.
   */
  readonly workingPath: string
  readonly visualizationDirectory?: string
  readonly mcpExtensionFactory?: ExtensionFactory
  readonly sessionsExtensionFactory?: ExtensionFactory
  readonly extensionFactories?: readonly ExtensionFactory[]
  readonly trustedExtensionFactories?: readonly ExtensionFactory[]
  readonly systemPromptAppendices?: readonly string[]
} & PiRuntimeExtensionIsolationInput

export function createWaggleRunExtensions(
  input: PiWaggleKernelRunInput,
  waggleFactory: ExtensionFactory,
) {
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

  return {
    factories: [
      createRunAttributionExtension(input.runId),
      peerReports.factory,
      orchestrationUpdates.factory,
      specificationUpdates.factory,
      ...(input.sessionsExtensionFactory ? [input.sessionsExtensionFactory] : []),
      ...(input.mcpExtensionFactory ? [input.mcpExtensionFactory] : []),
      ...(input.extensionFactories ?? []),
      ...(input.sessionIdentityContext
        ? [
            createAgentRunContextExtension({
              sessionIdentityContext: input.sessionIdentityContext,
              ...(input.agentInstructions ? { agentInstructions: input.agentInstructions } : {}),
              ...(input.toolAllowlist ? { toolAllowlist: input.toolAllowlist } : {}),
            }),
          ]
        : []),
    ],
    trustedFactories: [...(input.trustedExtensionFactories ?? []), waggleFactory],
    close() {
      peerReports.close()
      orchestrationUpdates.close()
      specificationUpdates.close()
    },
  }
}
