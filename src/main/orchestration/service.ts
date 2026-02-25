import { defaultOrchestrationServiceDeps } from './service/deps'
import { hasWebIntent } from './service/planner'
import { createOrchestratedAgentRunner } from './service/runner'

export type {
  OrchestratedAgentRunParams,
  OrchestratedAgentRunResult,
  OrchestrationServiceDeps,
} from './service/types'

export { createOrchestratedAgentRunner, hasWebIntent }

export const runOrchestratedAgent = createOrchestratedAgentRunner(defaultOrchestrationServiceDeps)
