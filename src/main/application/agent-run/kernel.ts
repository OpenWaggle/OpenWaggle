import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import { hydratePayloadAttachments } from '../run-handler-utils'
import type { AgentRunInput } from './types'

export function hydrateAgentRunPayload(payload: AgentSendPayload) {
  return Effect.gen(function* () {
    return {
      ...payload,
      attachments: yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments)),
    } satisfies HydratedAgentSendPayload
  })
}

export function runAgentKernel(
  input: AgentRunInput,
  payload: HydratedAgentSendPayload,
  preflight: {
    readonly session: SessionDetail
    readonly skillToggles?: Record<string, boolean>
  },
) {
  return Effect.gen(function* () {
    const agentKernel = yield* AgentKernelService
    return yield* agentKernel.run({
      session: preflight.session,
      runId: input.runId,
      payload,
      model: input.model,
      signal: input.signal,
      onEvent: input.onEvent,
      ...(preflight.skillToggles ? { skillToggles: preflight.skillToggles } : {}),
    })
  })
}
