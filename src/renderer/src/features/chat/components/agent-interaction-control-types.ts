import type { AgentLoopInteractionResponse } from '@shared/types/agent-loop-interaction'

export type AgentInteractionSubmit = (response: AgentLoopInteractionResponse) => void
