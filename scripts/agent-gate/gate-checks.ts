/**
 * The checks the end-of-turn agent gate runs. Rule catalogue entries name them as `gate:<check>`
 * in their `by` list, and check:repository-standards rejects a name missing here.
 */
export const GATE_CHECKS = [
  'format',
  'lint',
  'typecheck',
  'suppressions',
  'dependencies',
  'tsconfig',
  'generated',
  'tests',
  'docs',
  'loop',
  // The git guardrails extension (.pi/extensions/git-guardrails.ts) blocks hook bypasses per call.
  'git-guardrails',
] as const

export type GateCheck = (typeof GATE_CHECKS)[number]
