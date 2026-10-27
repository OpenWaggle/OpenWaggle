/**
 * Types of the agent-context evaluation (`pnpm evaluate:agent-context`, decision 7 of the v1
 * performance plan): script-graded tasks that a real model runs through a packaged build.
 */

export type EvalTaskGroup =
  | 'core-coding'
  | 'deferred-first-party-tools'
  | 'mcp-codemode'
  | 'hive'
  | 'skills'
  | 'truncated-output'
  | 'compaction-recall'
  | 'browser-preview'

/** What a finished task Run left behind, as plain data, so a grader is a pure function. */
export interface EvalOutcome {
  /** The last assistant text of the Session the task started. */
  readonly answer: string
  /** The contents of the files the task inspects, by project-relative path; null when missing. */
  readonly files: Readonly<Record<string, string | null>>
  /** Every tool the Run's Sessions called, including tools a codemode script called. */
  readonly toolNames: readonly string[]
  /** Sessions the Run created, the started one included (Workers add to it). */
  readonly sessionCount: number
  readonly compactions: number
  /** The output of `verify` commands the task runs in the project after the Run, by command. */
  readonly verifications: Readonly<Record<string, { readonly exitCode: number; readonly output: string }>>
}

export interface EvalGrade {
  readonly pass: boolean
  readonly reason: string
}

export interface EvalTaskContext {
  /** A local page served for the task, for browser preview tasks. */
  readonly previewUrl: string | null
}

export interface EvalTask {
  readonly id: string
  readonly group: EvalTaskGroup
  readonly prompt: (context: EvalTaskContext) => string
  /** Writes the task's fixture into the fresh project (a git repository with one commit). */
  readonly setup?: (projectPath: string) => Promise<void>
  /** Runs after the fixture is committed, for state that must stay uncommitted (a staged change). */
  readonly afterCommit?: (projectPath: string) => Promise<void>
  /** Project-relative files the grader reads. */
  readonly inspectFiles?: readonly string[]
  /** Shell commands run in the project after the Run; their results reach the grader. */
  readonly verify?: readonly string[]
  readonly grade: (outcome: EvalOutcome) => EvalGrade
  /** The fixture MCP inventory server is configured (exposure `direct` in the file). */
  readonly mcpInventory?: boolean
  /** A page the harness serves, for browser preview tasks. */
  readonly previewPage?: string
  /** App settings the task needs, applied through the window before the Run. */
  readonly settings?: Readonly<Record<string, unknown>>
  /** Titles of Sessions created in the project before the task's Run starts. */
  readonly otherSessions?: readonly string[]
  readonly timeoutMs?: number
  /** A passing outcome, for the deterministic grader tests. */
  readonly reference: Partial<EvalOutcome>
}

export const EMPTY_OUTCOME: EvalOutcome = {
  answer: '',
  files: {},
  toolNames: [],
  sessionCount: 1,
  compactions: 0,
  verifications: {},
}

export function outcomeWith(partial: Partial<EvalOutcome>): EvalOutcome {
  return { ...EMPTY_OUTCOME, ...partial }
}

export function grade(pass: boolean, reason: string): EvalGrade {
  return { pass, reason }
}

/** Whether the Run used a tool, directly or from a codemode script. */
export function usedTool(outcome: EvalOutcome, pattern: RegExp) {
  return outcome.toolNames.some((name) => pattern.test(name))
}

export function answerMatches(outcome: EvalOutcome, pattern: RegExp) {
  return pattern.test(outcome.answer)
}

export function verificationPassed(outcome: EvalOutcome, command: string) {
  return outcome.verifications[command]?.exitCode === 0
}
