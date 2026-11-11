/**
 * One gate verdict over a set of changed files. The gate exists to stop an agent from getting a
 * change through by checking less: new suppressions and silencing casts, a weaker tsconfig, a
 * loosened lint config, a raised budget or grown exemption list, skipped or deleted tests, plus
 * the hand-edited generated files the Session recorded. It also reports formatting, lint and type
 * errors and any plugged-in checks (Fallow, React Doctor) in the changed files, so the agent fixes
 * its own breakage. Pure apart from the tool runs and file reads it is given.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Baseline } from './baseline'
import { type Finding, type ToolFailure } from './findings'
import type { RunProcess } from '../agent-quality-gates/process'
import { newSuppressions } from './suppressions'
import { type LintRunner, formatCheck, lintCheck } from './tool-checks'
import { affectedProjects, typecheckProjects, typeErrorFindings } from './typecheck'
import { tsconfigCheck } from './tsconfig-strictness'
import { lintConfigFindings } from './lint-config'
import { ratchetFindings } from './ratchets'
import { deletedTestFindings, skippedTestFindings } from './skipped-tests'

export interface PluginResult {
  readonly findings: readonly Finding[]
  readonly failures: readonly ToolFailure[]
}

/** A check another module adds to the gate, such as Fallow and React Doctor. */
export interface GatePlugin {
  readonly name: string
  readonly run: (input: {
    readonly root: string
    readonly files: readonly string[]
    readonly run: RunProcess
    readonly signal?: AbortSignal
  }) => Promise<PluginResult>
}

export interface GateInput {
  readonly root: string
  readonly files: readonly string[]
  readonly baseline: Baseline
  readonly run: RunProcess
  readonly runner: LintRunner
  /** Findings the Session recorded, such as hand-edited generated files. */
  readonly sessionFindings?: readonly Finding[]
  readonly plugins?: readonly GatePlugin[]
  /** Type error keys from the Session-start type check; see typecheck.ts. */
  readonly typeBaseline?: () => Promise<ReadonlySet<string> | undefined>
  readonly signal?: AbortSignal
}

export interface Verdict {
  readonly findings: readonly Finding[]
  readonly failures: readonly ToolFailure[]
  readonly files: readonly string[]
  readonly durationMs: number
}

const LINTED_IDS = new Set(['TS-05', 'TS-08'])

function currentText(root: string) {
  return (file: string) => readFile(path.join(root, file), 'utf8').catch(() => undefined)
}

async function suppressionFindings(input: GateInput, existing: readonly string[]) {
  const text = currentText(input.root)
  const found = await Promise.all(
    existing.map(async (file) =>
      newSuppressions(file, await input.baseline.text(file), (await text(file)) ?? ''),
    ),
  )
  return found.flat()
}

function tsconfigResult(input: GateInput): Promise<PluginResult> {
  return tsconfigCheck({
    root: input.root,
    files: input.files,
    run: input.run,
    before: (file) => input.baseline.text(file),
    after: currentText(input.root),
  })
}

/** The checks that compare a changed file with its baseline text. */
async function cheatFindings(input: GateInput, existing: readonly string[]) {
  const text = currentText(input.root)
  const present = new Set(existing)
  const states = await Promise.all(
    input.files.map(async (file) => {
      const [before, after] = await Promise.all([
        input.baseline.text(file),
        present.has(file) ? text(file) : Promise.resolve(undefined),
      ])
      return { file, before, after }
    }),
  )
  const perFile = states.flatMap(({ file, before, after }) => [
    ...lintConfigFindings(file, before, after),
    ...ratchetFindings(file, before, after),
    ...skippedTestFindings(file, before, after),
  ])
  const deleted = await deletedTestFindings(
    states.map(({ file, before, after }) => ({
      file,
      existedBefore: before !== undefined,
      existsNow: after !== undefined,
    })),
    async (file) => (await text(file)) !== undefined,
    async (file) => (await input.baseline.text(file)) !== undefined,
  )
  return [...perFile, ...deleted]
}

async function existingFiles(root: string, files: readonly string[]) {
  const text = currentText(root)
  const present = await Promise.all(
    files.map(async (file) => ((await text(file)) === undefined ? [] : [file])),
  )
  return present.flat()
}

async function typecheckResult(
  input: GateInput,
  existing: readonly string[],
): Promise<PluginResult> {
  const projects = affectedProjects(existing)
  if (projects.length === 0) return { findings: [], failures: [] }
  const [result, baseline] = await Promise.all([
    typecheckProjects(input.run, input.root, projects, input.signal),
    input.typeBaseline?.(),
  ])
  const files = result.failures.length > 0 ? existing : []
  return {
    findings: typeErrorFindings(result.errors, existing, baseline),
    failures: result.failures.map((failure) => ({ ...failure, files })),
  }
}

async function toolResults(input: GateInput, existing: readonly string[]) {
  const shared = {
    root: input.root,
    files: existing,
    run: input.run,
    runner: input.runner,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }
  return Promise.all([
    formatCheck(shared),
    lintCheck(shared),
    typecheckResult(input, existing),
    ...(input.plugins ?? []).map((plugin) =>
      plugin
        .run({
          root: input.root,
          files: existing,
          run: input.run,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        .catch((error: unknown) => ({
          findings: [],
          failures: [
            {
              check: plugin.name,
              files: existing,
              reason: error instanceof Error ? error.message : String(error),
            },
          ],
        })),
    ),
  ])
}

export async function runGate(
  input: GateInput,
  now: () => number = performance.now.bind(performance),
): Promise<Verdict> {
  const started = now()
  const existing = await existingFiles(input.root, input.files)
  const [tools, suppressions, tsconfigs, cheats] = await Promise.all([
    toolResults(input, existing),
    suppressionFindings(input, existing),
    tsconfigResult(input),
    cheatFindings(input, existing),
  ])
  const toolFindings = tools.flatMap((result) => result.findings)
  // A directive or cast lint already reported (ban-ts-comment, no-explicit-any) is not repeated.
  const linted = new Set(
    toolFindings
      .filter((finding) => finding.id !== undefined && LINTED_IDS.has(finding.id))
      .map((finding) => `${finding.id ?? ''} ${finding.file}:${finding.line ?? 0}`),
  )
  return {
    findings: [
      ...(input.sessionFindings ?? []),
      ...toolFindings,
      ...suppressions.filter(
        (finding) => !linted.has(`${finding.id ?? ''} ${finding.file}:${finding.line ?? 0}`),
      ),
      ...tsconfigs.findings,
      ...cheats,
    ],
    failures: [...tools.flatMap((result) => result.failures), ...tsconfigs.failures],
    files: input.files,
    durationMs: now() - started,
  }
}
