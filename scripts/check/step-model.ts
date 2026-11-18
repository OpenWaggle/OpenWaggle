/**
 * The shape of a check step and the graph helpers the runner needs. The steps themselves are
 * declared in `./steps.ts`.
 */

/** One process to start: the executable, then its arguments. Never run through a shell. */
export type StepCommand = readonly [string, ...string[]]

/** How a step reports what failed. */
export type FindingFormat =
  /** The tool already prints one finding per line (`scripts/lint.ts`, the standards check). */
  | 'lines'
  /** tsc `--pretty false`: `file(line,col): error TSxxxx: message`. */
  | 'tsc'
  /** Vitest with the compact reporter (`scripts/test-support/vitest-compact-reporter.ts`). */
  | 'vitest'
  /** Anything else: lines that start with `file:line`, or the end of the log. */
  | 'generic'

/** A step that can run on a list of files, so `--changed` can scope it to the changed ones. */
export interface ChangedFileScope {
  /** Globs of the files the scoped command accepts. */
  readonly files: readonly string[]
  /** A change to one of these (the tool's config, say) needs the whole step, not a file list. */
  readonly fullRunOn?: readonly string[]
  /** The command that checks just these files. */
  readonly command: (files: readonly string[]) => StepCommand
}

/**
 * Skips the step when none of its `inputs` changed since it last passed and its `outputs` exist.
 * Only for steps whose outputs are a pure function of their inputs, such as package builds.
 */
export interface StepCache {
  readonly outputs: readonly string[]
}

export interface CheckStep {
  readonly id: string
  /** What the step proves, for `--list`. */
  readonly summary: string
  /** Run in order; the step fails at the first command that exits non-zero. */
  readonly commands: readonly StepCommand[]
  readonly dependsOn?: readonly string[]
  /**
   * Repository globs the step reads (micromatch, dot files included). `--changed` runs a step only
   * when a changed file matches, and a cached step re-runs when one of them changes.
   */
  readonly inputs: readonly string[]
  readonly changedFiles?: ChangedFileScope
  readonly cache?: StepCache
  readonly findings: FindingFormat
  /** One line telling an agent how to fix or reproduce a failure. */
  readonly hint: string
  readonly env?: Readonly<Record<string, string>>
  /** Working directory relative to the repository root (default: the root). */
  readonly cwd?: string
  /**
   * The step only advises: its output lines print after the summary even when the gate passes,
   * and a non-zero exit fails nothing.
   */
  readonly advisory?: true
}

export interface CheckGate {
  readonly id: string
  readonly summary: string
  readonly steps: readonly string[]
}

/** Fails when an id repeats, a dependency is unknown, or the dependencies form a cycle. */
export function validateStepGraph(steps: readonly CheckStep[], gates: readonly CheckGate[]) {
  const errors: string[] = []
  const byId = new Map<string, CheckStep>()
  for (const step of steps) {
    if (byId.has(step.id)) errors.push(`step "${step.id}" is declared twice`)
    byId.set(step.id, step)
  }
  for (const step of steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!byId.has(dependency)) errors.push(`step "${step.id}" depends on unknown "${dependency}"`)
    }
  }
  for (const gate of gates) {
    for (const id of gate.steps) {
      if (!byId.has(id)) errors.push(`gate "${gate.id}" lists unknown step "${id}"`)
    }
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  const visit = (id: string, trail: readonly string[]) => {
    if (done.has(id)) return
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...trail, id].join(' -> ')}`)
      return
    }
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency, [...trail, id])
    visiting.delete(id)
    done.add(id)
  }
  for (const step of steps) visit(step.id, [])
  return errors
}

/** The requested steps plus everything they depend on, in declaration order. */
export function withDependencies(steps: readonly CheckStep[], ids: Iterable<string>) {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const selected = new Set<string>()
  const add = (id: string) => {
    if (selected.has(id)) return
    const step = byId.get(id)
    if (step === undefined) throw new Error(`unknown step "${id}"`)
    selected.add(id)
    for (const dependency of step.dependsOn ?? []) add(dependency)
  }
  for (const id of ids) add(id)
  return steps.filter((step) => selected.has(step.id))
}
