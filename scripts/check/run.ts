/**
 * Runs a check gate as a parallel step graph. The steps and gates are declared in ./steps.ts; add
 * a step there.
 *
 *   bun scripts/check/run.ts [check|verify] [--only <ids>] [--skip <ids>] [--changed]
 *                            [--base <ref>] [--concurrency <n>] [--no-cache] [--list]
 *
 * - `--only a,b`: just these steps and what they depend on.
 * - `--skip a,b`: leave these out; steps depending on them still run.
 * - `--changed`: only the steps that take file lists (format, lint, repository standards), on the
 *   files changed since the merge base with `--base` (default origin/main), plus their
 *   dependencies.
 * - `--concurrency n` (or CHECK_CONCURRENCY): steps in flight; the default is half the cores.
 * - `--no-cache`: re-run cached steps (package builds) even when their inputs did not change.
 * - `--list`: print the gate's steps and exit.
 *
 * Each step's output goes to .tmp/check/<step>.log and the timings to .tmp/check/report.json. A
 * green run prints one line. A failed step prints its findings (or the end of its log), a fix
 * hint and its log path.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { parseRunArguments, type RunOptions } from './arguments'
import { planAll, planChanged, type PlannedStep, selectSteps } from './plan'
import { listChangedFiles } from './repository-files'
import {
  advisoryFindings,
  advisoryOutput,
  CHECK_OUTPUT_DIRECTORY,
  failureOutput,
  formatStepList,
  logPath,
  REPORT_FILE,
  type RunReport,
  type StepReport,
  seconds,
  summaryLine,
} from './report'
import { executeSteps, runningChildren } from './scheduler'
import { validateStepGraph } from './step-model'
import { GATES, STEPS } from './steps'
import { scriptEnv } from '../support/env'

const INTERRUPTED_EXIT_CODE = 130
const JSON_INDENT = 2
const SCRIPT_ARGUMENTS_START = 2

function stopChildren() {
  for (const child of runningChildren) child.kill('SIGTERM')
}

async function writeReport(
  gateId: string,
  options: RunOptions,
  startedAt: Date,
  durationMs: number,
  steps: readonly StepReport[],
  ok: boolean,
) {
  const report: RunReport = {
    gate: gateId,
    ok,
    startedAt: startedAt.toISOString(),
    durationMs,
    concurrency: options.concurrency,
    cores: os.availableParallelism(),
    loadAverage: os.loadavg(),
    changedOnly: options.changed,
    steps,
  }
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, JSON_INDENT)}\n`)
}

async function outputLines(
  gateId: string,
  planned: readonly PlannedStep[],
  steps: readonly StepReport[],
  durationMs: number,
) {
  const lines: string[] = []
  const advisories: string[] = []
  for (const report of steps) {
    const step = planned.find((entry) => entry.step.id === report.id)?.step
    if (step === undefined) continue
    if (report.status === 'failed') lines.push(...(await failureOutput(step, report)))
    else advisories.push(...advisoryOutput(step, report))
  }
  lines.push(summaryLine(gateId, steps, durationMs))
  // On Actions the job summary turns them into annotations, and the green log stays one line.
  if (scriptEnv().GITHUB_ACTIONS !== 'true') lines.push(...advisories)
  return lines
}

async function changedFiles(base: string) {
  try {
    return await listChangedFiles(base)
  } catch {
    throw new Error(
      `--changed could not diff against ${base}; fetch it (git fetch origin main) or pass --base <ref>`,
    )
  }
}

export async function runGate(argv: readonly string[]) {
  const options = parseRunArguments(argv)
  const graphErrors = validateStepGraph(STEPS, GATES)
  if (graphErrors.length > 0) throw new Error(`invalid step graph: ${graphErrors.join('; ')}`)
  const gate = GATES.find((entry) => entry.id === options.gate)
  if (gate === undefined) {
    throw new Error(`unknown gate "${options.gate}" (${GATES.map((entry) => entry.id).join(', ')})`)
  }
  const selected = selectSteps(STEPS, gate, options)
  if (options.list) {
    console.log(formatStepList(gate, GATES, selected))
    return 0
  }

  const startedAt = new Date()
  const started = performance.now()
  await mkdir(CHECK_OUTPUT_DIRECTORY, { recursive: true })
  const planned = options.changed
    ? planChanged(STEPS, selected, await changedFiles(options.base))
    : planAll(selected)
  if (planned.length === 0) {
    console.log(`${gate.id}: no steps to run`)
    return 0
  }
  await Promise.all(planned.map(({ step }) => rm(logPath(step.id), { force: true })))

  process.once('SIGINT', stopChildren)
  process.once('SIGTERM', stopChildren)
  const { reports, interrupted } = await executeSteps(planned, options, started)
  const durationMs = performance.now() - started
  const steps = await Promise.all(
    planned.flatMap(({ step }): Promise<StepReport>[] => {
      const report = reports.get(step.id)
      if (report === undefined) return []
      if (step.advisory !== true) return [Promise.resolve(report)]
      return [advisoryFindings(report).then((advisories) => ({ ...report, advisories }))]
    }),
  )
  const ok =
    !interrupted &&
    steps.length === planned.length &&
    steps.every((report) => report.status !== 'failed' && report.status !== 'blocked')
  await writeReport(gate.id, options, startedAt, durationMs, steps, ok)

  if (interrupted) {
    console.log(`${gate.id}: interrupted after ${seconds(durationMs)}`)
    return INTERRUPTED_EXIT_CODE
  }
  console.log((await outputLines(gate.id, planned, steps, durationMs)).join('\n'))
  return ok ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGate(process.argv.slice(SCRIPT_ARGUMENTS_START)).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.error(`check: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    },
  )
}
