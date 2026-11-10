/**
 * One gate verdict over a set of changed files: formatting, lint and type errors, new
 * suppressions, dependency pins, weakened tsconfigs, stale docs and any plugged-in checks, plus
 * the findings the Session recorded while the agent worked (hand-edited generated files, missing
 * test runs). Pure apart from the tool runs and file reads it is given.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Baseline } from './baseline'
import { staleDocs } from './doc-watch'
import { type Finding, type ToolFailure } from './findings'
import type { RunProcess } from '../agent-quality-gates/process'
import { newSuppressions } from './suppressions'
import { type LintRunner, formatCheck, lintCheck } from './tool-checks'
import { affectedProjects, typecheckProjects, typeErrorFindings } from './typecheck'
import { TSCONFIG_FILE, tsconfigFinding, tsconfigWeakenings } from './tsconfig-strictness'

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

/** Checks of changed manifests; see dependencies.ts. */
export type DependencyCheck = (input: {
  readonly root: string
  readonly manifests: readonly string[]
  readonly baseline: Baseline
  readonly text: (file: string) => Promise<string | undefined>
}) => Promise<PluginResult>

export interface GateInput {
  readonly root: string
  readonly files: readonly string[]
  readonly baseline: Baseline
  readonly run: RunProcess
  readonly runner: LintRunner
  /** Findings the Session recorded, such as hand-edited generated files. */
  readonly sessionFindings?: readonly Finding[]
  /** Whether the user allowed this weakening of this tsconfig. */
  readonly tsconfigApproved?: (file: string, weakenings: readonly string[]) => boolean
  readonly dependencies?: DependencyCheck
  readonly plugins?: readonly GatePlugin[]
  /** Type error keys from the Session-start type check; see typecheck.ts. */
  readonly typeBaseline?: () => Promise<ReadonlySet<string> | undefined>
  /** Files changed earlier in the Session, so a doc updated then counts. */
  readonly sessionFiles?: readonly string[]
  readonly signal?: AbortSignal
}

export interface Verdict {
  readonly findings: readonly Finding[]
  readonly failures: readonly ToolFailure[]
  readonly files: readonly string[]
  readonly durationMs: number
}

const MANIFEST = /(?:^|\/)package\.json$/u

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

async function tsconfigFindings(input: GateInput, existing: readonly string[]) {
  const text = currentText(input.root)
  const configs = existing.filter((file) => TSCONFIG_FILE.test(file))
  const found = await Promise.all(
    configs.map(async (file) => {
      const weakenings = tsconfigWeakenings(
        await input.baseline.text(file),
        (await text(file)) ?? '',
      )
      const approved = input.tsconfigApproved?.(file, weakenings) === true
      return weakenings.length === 0 || approved ? [] : [tsconfigFinding(file, weakenings)]
    }),
  )
  return found.flat()
}

function docFindings(input: GateInput): Finding[] {
  const updated = [...new Set([...(input.sessionFiles ?? []), ...input.files])]
  return staleDocs(input.files, updated).map((stale) => ({
    file: stale.file,
    rule: 'gate/docs',
    id: 'DOC-01',
    message: `changed without ${stale.docs.join(' or ')}; update it if it no longer holds`,
    severity: 'advisory' as const,
  }))
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
  const manifests = existing.filter((file) => MANIFEST.test(file))
  return Promise.all([
    formatCheck(shared),
    lintCheck(shared),
    typecheckResult(input, existing),
    input.dependencies === undefined || manifests.length === 0
      ? { findings: [], failures: [] }
      : input.dependencies({
          root: input.root,
          manifests,
          baseline: input.baseline,
          text: currentText(input.root),
        }),
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
  const [tools, suppressions, tsconfigs] = await Promise.all([
    toolResults(input, existing),
    suppressionFindings(input, existing),
    tsconfigFindings(input, existing),
  ])
  const toolFindings = tools.flatMap((result) => result.findings)
  // A directive lint already reported (typescript/ban-ts-comment, TS-08) is not reported twice.
  const linted = new Set(
    toolFindings
      .filter((finding) => finding.id === 'TS-08')
      .map((finding) => `${finding.file}:${finding.line ?? 0}`),
  )
  return {
    findings: [
      ...(input.sessionFindings ?? []),
      ...toolFindings,
      ...suppressions.filter((finding) => !linted.has(`${finding.file}:${finding.line ?? 0}`)),
      ...tsconfigs,
      ...docFindings(input),
    ],
    failures: tools.flatMap((result) => result.failures),
    files: input.files,
    durationMs: now() - started,
  }
}
