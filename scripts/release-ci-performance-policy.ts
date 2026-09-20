import { matchesSessionPerformanceWorkflowAstContract } from './package-release-validator-workflow-structure'

export const SESSION_PERFORMANCE_WORKFLOW_PATH = '.github/workflows/session-performance.yml'

export function validateSessionPerformanceCiPolicy(workflowText: string): string[] {
  return matchesSessionPerformanceWorkflowAstContract(workflowText)
    ? []
    : ['Session Performance workflow must match its exact fail-closed AST contract.']
}
