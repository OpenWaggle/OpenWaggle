import type { OrchestrationEventPayload, OrchestrationRunRecord } from '@shared/types/orchestration'

export interface OrchestrationProps {
  readonly orchestrationRuns?: readonly OrchestrationRunRecord[]
  readonly orchestrationEvents?: readonly OrchestrationEventPayload[]
  readonly onCancelOrchestrationRun?: (runId: string) => Promise<void> | void
}
