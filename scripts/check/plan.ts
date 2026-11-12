/**
 * Which steps a run executes, and with which commands.
 */
import micromatch from 'micromatch'
import type { RunOptions } from './arguments'
import { type CheckGate, type CheckStep, type StepCommand, withDependencies } from './step-model'

/** A step as it will run: its commands, possibly scoped to changed files. */
export interface PlannedStep {
  readonly step: CheckStep
  readonly commands: readonly StepCommand[]
  /** Set when `--changed` found no file for the step to check. */
  readonly unchanged?: boolean
}

/**
 * Above this many files a scoped command runs whole instead: the file list would approach the
 * command-line length limit (about 32k characters on Windows), and checking that many files costs
 * about what the whole run does.
 */
export const MAX_SCOPED_FILES = 300

function matchesAny(file: string, globs: readonly string[]) {
  return globs.length > 0 && micromatch.isMatch(file, [...globs], { dot: true })
}

/** The gate's steps (or `--only`), their dependencies, minus `--skip`. */
export function selectSteps(
  steps: readonly CheckStep[],
  gate: CheckGate,
  options: Pick<RunOptions, 'only' | 'skip'>,
) {
  const requested = options.only.length > 0 ? options.only : gate.steps
  const skipped = new Set(options.skip)
  return withDependencies(steps, requested).filter((step) => !skipped.has(step.id))
}

function scopedStep(step: CheckStep, changedFiles: readonly string[]) {
  const scope = step.changedFiles
  if (scope === undefined) return undefined
  if (changedFiles.some((file) => matchesAny(file, scope.fullRunOn ?? []))) {
    const result: PlannedStep | undefined = { step, commands: step.commands }
    return result
  }
  const files = changedFiles.filter((file) => matchesAny(file, scope.files))
  if (files.length === 0) {
    const result: PlannedStep | undefined = { step, commands: [], unchanged: true }
    return result
  }
  if (files.length > MAX_SCOPED_FILES) {
    const result: PlannedStep | undefined = { step, commands: step.commands }
    return result
  }
  const result: PlannedStep | undefined = { step, commands: [scope.command(files)] }
  return result
}

/**
 * `--changed`: the selected steps that take file lists, scoped to the changed files (or run whole
 * when their config changed), plus the dependencies of those that have files to check.
 */
export function planChanged(
  steps: readonly CheckStep[],
  selected: readonly CheckStep[],
  changedFiles: readonly string[],
) {
  const planned = new Map<string, PlannedStep>()
  for (const step of selected) {
    const entry = scopedStep(step, changedFiles)
    if (entry !== undefined) planned.set(step.id, entry)
  }
  const needed = [...planned.values()]
    .filter((entry) => entry.unchanged !== true)
    .map((entry) => entry.step.id)
  if (needed.length > 0) {
    for (const dependency of withDependencies(steps, needed)) {
      if (!planned.has(dependency.id)) {
        planned.set(dependency.id, { step: dependency, commands: dependency.commands })
      }
    }
  }
  return steps.flatMap((step) => planned.get(step.id) ?? [])
}

export function planAll(selected: readonly CheckStep[]) {
  return selected.map((step) => ({ step, commands: step.commands }))
}
