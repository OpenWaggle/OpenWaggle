// Agent loop iteration limits, depth, and parallelism.

/** Skill activation heuristics */
export const SKILL_ACTIVATION = {
  /** Minimum similarity score to consider a heuristic match */
  THRESHOLD: 0.2,
  /** Max heuristic-based skill matches per activation */
  MAX_MATCHES: 2,
} as const
