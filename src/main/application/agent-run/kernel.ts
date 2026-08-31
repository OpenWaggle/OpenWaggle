import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { type AgentKernelRunInput, AgentKernelService } from '../../ports/agent-kernel-service'
import { hydratePayloadAttachments } from '../run-handler-utils'
import type { AgentRunInput } from './types'

interface AgentRunKernelPreflight {
  readonly session: SessionDetail
  readonly skillToggles?: Record<string, boolean>
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
}

export function hydrateAgentRunPayload(
  payload: AgentSendPayload,
  hydratedAttachments?: HydratedAgentSendPayload['attachments'],
) {
  return Effect.gen(function* () {
    if (
      hydratedAttachments &&
      (hydratedAttachments.length !== payload.attachments.length ||
        hydratedAttachments.some(
          (attachment, index) => attachment.id !== payload.attachments[index]?.id,
        ))
    ) {
      return yield* Effect.fail(
        new Error('Pre-hydrated attachments do not match the authorized payload.'),
      )
    }
    return {
      ...payload,
      attachments:
        hydratedAttachments ??
        (yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments))),
    } satisfies HydratedAgentSendPayload
  })
}

function runContextOptions(input: AgentRunInput) {
  return {
    ...(input.runAuthorizationOverride
      ? { runAuthorizationOverride: input.runAuthorizationOverride }
      : {}),
    ...(input.authorityCallerId ? { authorityCallerId: input.authorityCallerId } : {}),
    ...(input.agentInstructions ? { agentInstructions: input.agentInstructions } : {}),
    ...(input.sessionIdentityContext
      ? { sessionIdentityContext: input.sessionIdentityContext }
      : {}),
    ...runDeliveryContextOptions(input),
    ...(input.toolAllowlist ? { toolAllowlist: input.toolAllowlist } : {}),
    ...(input.skillAllowlist ? { skillAllowlist: input.skillAllowlist } : {}),
    ...(input.mcpServerAllowlist ? { mcpServerAllowlist: input.mcpServerAllowlist } : {}),
    ...(input.sessionCapabilities ? { sessionCapabilities: input.sessionCapabilities } : {}),
    ...(input.modelMultiAgentEnabled !== undefined
      ? { modelMultiAgentEnabled: input.modelMultiAgentEnabled }
      : {}),
  }
}

function runDeliveryContextOptions(input: AgentRunInput) {
  return {
    ...(input.peerAgentReports ? { peerAgentReports: input.peerAgentReports } : {}),
    ...(input.onPeerAgentReportsDelivered
      ? { onPeerAgentReportsDelivered: input.onPeerAgentReportsDelivered }
      : {}),
    ...(input.orchestrationUpdates ? { orchestrationUpdates: input.orchestrationUpdates } : {}),
    ...(input.onOrchestrationUpdatesDelivered
      ? { onOrchestrationUpdatesDelivered: input.onOrchestrationUpdatesDelivered }
      : {}),
    ...(input.delegationSpecificationUpdates
      ? { delegationSpecificationUpdates: input.delegationSpecificationUpdates }
      : {}),
    ...(input.onDelegationSpecificationUpdatesDelivered
      ? {
          onDelegationSpecificationUpdatesDelivered:
            input.onDelegationSpecificationUpdatesDelivered,
        }
      : {}),
  }
}

function preflightOptions(preflight: AgentRunKernelPreflight) {
  return {
    ...(preflight.skillToggles ? { skillToggles: preflight.skillToggles } : {}),
    ...(preflight.enabledOpenWaggleExtensionPackagePaths
      ? {
          enabledOpenWaggleExtensionPackagePaths: preflight.enabledOpenWaggleExtensionPackagePaths,
        }
      : {}),
  }
}

export function runAgentKernel(
  input: AgentRunInput,
  payload: HydratedAgentSendPayload,
  preflight: AgentRunKernelPreflight,
) {
  return Effect.gen(function* () {
    const agentKernel = yield* AgentKernelService
    const kernelInput: AgentKernelRunInput = {
      session: preflight.session,
      runId: input.runId,
      payload,
      model: input.model,
      ...runContextOptions(input),
      signal: input.signal,
      onEvent: input.onEvent,
      ...(input.onWorktreeLaunch ? { onWorktreeLaunch: input.onWorktreeLaunch } : {}),
      ...preflightOptions(preflight),
    }
    return yield* agentKernel.run(kernelInput)
  })
}
