// Agent loop iteration limits, depth, and parallelism.

/** Agent loop iteration budget */
export const AGENT_LOOP = {
  /** Max iterations per agent run */
  MAX_ITERATIONS: 25,
} as const

/** Sub-agent execution limits */
export const SUB_AGENT = {
  /** Max sub-agent nesting depth */
  MAX_DEPTH: 3,
  /** Max concurrent background sub-agents */
  MAX_CONCURRENT_BACKGROUND: 4,
} as const

/** Orchestration executor limits */
export const EXECUTOR = {
  /** Max iterations per executor run */
  MAX_ITERATIONS: 20,
} as const

/** Orchestration parallelism */
export const ORCHESTRATION = {
  /** Max concurrent tasks */
  MAX_PARALLEL_TASKS: 4,
  /** Min agents for orchestrate tool */
  MIN_TASKS: 2,
  /** Max agents for orchestrate tool */
  MAX_TASKS: 5,
  /** Max tasks a planner can produce */
  MAX_PLAN_TASKS: 10,
} as const
