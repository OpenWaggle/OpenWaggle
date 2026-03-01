import { defaultOrchestrationServiceDeps } from './service/deps'
import { createOrchestratedAgentRunner } from './service/runner'

export type {
  OrchestratedAgentRunParams,
  OrchestratedAgentRunResult,
  OrchestrationServiceDeps,
} from './service/types'

export { createOrchestratedAgentRunner }

export const runOrchestratedAgent = createOrchestratedAgentRunner(defaultOrchestrationServiceDeps)
