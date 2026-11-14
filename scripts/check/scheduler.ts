/**
 * Runs planned steps as a dependency graph: a step starts once its dependencies passed, at most
 * `concurrency` at a time, the longest remaining chain first. Each step's output goes to its log.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { RunOptions } from './arguments'
import {
  readJsonFile,
  readStepCache,
  stepFingerprint,
  stepOutputsExist,
  writeStepCache,
} from './cache'
import type { PlannedStep } from './plan'
import { listRepositoryFiles } from './repository-files'
import { logPath, REPORT_FILE, reportDurations, type StepReport } from './report'
import type { CheckStep, StepCommand } from './step-model'

/** Assumed duration of a step with no previous report, for ordering only. */
const UNKNOWN_DURATION_MS = 1000

/** Children in flight, so an interrupt can stop them. */
export const runningChildren = new Set<ChildProcess>()

interface CommandResult {
  readonly exitCode: number | null
  readonly interrupted: boolean
}

/** The environment every step gets: no colours, and no Vite config-loader notice. */
function stepEnvironment(step: CheckStep) {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
    ...step.env,
  } satisfies NodeJS.ProcessEnv
}

function runCommand(command: StepCommand, step: CheckStep, logFd: number) {
  const [executable, ...args] = command
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(executable, args, {
      cwd: step.cwd === undefined ? process.cwd() : path.resolve(step.cwd),
      env: stepEnvironment(step),
      stdio: ['ignore', logFd, logFd],
    })
    runningChildren.add(child)
    child.on('error', (error) => {
      runningChildren.delete(child)
      process.stderr.write(`check: could not start ${executable}: ${error.message}\n`)
      resolve({ exitCode: null, interrupted: false })
    })
    child.on('close', (code, signal) => {
      runningChildren.delete(child)
      resolve({ exitCode: code, interrupted: signal === 'SIGINT' || signal === 'SIGTERM' })
    })
  })
}

/** Longest remaining chain through each step, from the previous run's durations. */
function criticalPaths(planned: readonly PlannedStep[], durations: ReadonlyMap<string, number>) {
  const dependents = new Map<string, string[]>()
  for (const { step } of planned) {
    for (const dependency of step.dependsOn ?? []) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), step.id])
    }
  }
  const memo = new Map<string, number>()
  const length = (id: string): number => {
    const known = memo.get(id)
    if (known !== undefined) return known
    const after = Math.max(0, ...(dependents.get(id) ?? []).map(length))
    const total = (durations.get(id) ?? UNKNOWN_DURATION_MS) + after
    memo.set(id, total)
    return total
  }
  return new Map(planned.map(({ step }) => [step.id, length(step.id)]))
}

export interface Execution {
  readonly reports: ReadonlyMap<string, StepReport>
  readonly interrupted: boolean
}

async function runCommands(step: CheckStep, commands: readonly StepCommand[]) {
  const fd = openSync(logPath(step.id), 'w')
  let exitCode: number | null = 0
  let interrupted = false
  try {
    for (const command of commands) {
      const result = await runCommand(command, step, fd)
      exitCode = result.exitCode
      interrupted = result.interrupted
      if (exitCode !== 0) break
    }
  } finally {
    closeSync(fd)
  }
  return { exitCode, interrupted }
}

export async function executeSteps(
  planned: readonly PlannedStep[],
  options: Pick<RunOptions, 'cache' | 'concurrency'>,
  started: number,
) {
  const reports = new Map<string, StepReport>()
  const plannedIds = new Set(planned.map(({ step }) => step.id))
  const priority = criticalPaths(planned, reportDurations(await readJsonFile(REPORT_FILE)))
  const cache = options.cache ? await readStepCache() : {}
  const usesCache = options.cache && planned.some(({ step }) => step.cache !== undefined)
  const repositoryFiles = usesCache ? await listRepositoryFiles() : []
  const fingerprints = new Map<string, string>()
  const pending = new Map(planned.map((entry) => [entry.step.id, entry]))
  const active = new Map<string, Promise<void>>()
  // Held in an object because the step runners, not this loop's flow, set it.
  const run = { interrupted: false }
  const elapsed = () => performance.now() - started

  const finish = (id: string, report: Omit<StepReport, 'id' | 'log'>) => {
    reports.set(id, { id, log: logPath(id), ...report })
  }

  /** Returns the step's fingerprint when it is cacheable, or `cached` when it can be skipped. */
  const checkCache = async (step: CheckStep) => {
    if (step.cache === undefined || !options.cache) return undefined
    const dependencyPrints = (step.dependsOn ?? []).map((id) => fingerprints.get(id) ?? '')
    const print = await stepFingerprint(step, repositoryFiles, dependencyPrints)
    fingerprints.set(step.id, print)
    const hit = cache[step.id] === print && (await stepOutputsExist(step))
    return { print, hit }
  }

  const runStep = async ({ step, commands, unchanged }: PlannedStep) => {
    const startMs = elapsed()
    const base = { startMs, commands: commands.map((command) => command.join(' ')) }
    if (unchanged === true) {
      finish(step.id, { ...base, status: 'unchanged', durationMs: 0, exitCode: 0 })
      return
    }
    const cached = await checkCache(step)
    if (cached?.hit === true) {
      finish(step.id, { ...base, status: 'cached', durationMs: elapsed() - startMs, exitCode: 0 })
      return
    }
    const result = await runCommands(step, commands)
    if (result.interrupted) run.interrupted = true
    // An advisory step reports; even its crash fails nothing (its log keeps the exit).
    const status = result.exitCode === 0 || step.advisory === true ? 'passed' : 'failed'
    finish(step.id, { ...base, status, durationMs: elapsed() - startMs, exitCode: result.exitCode })
    if (status === 'passed' && cached !== undefined) cache[step.id] = cached.print
  }

  const isSatisfied = (id: string) => {
    if (!plannedIds.has(id)) return true
    const status = reports.get(id)?.status
    return status === 'passed' || status === 'cached' || status === 'unchanged'
  }
  const isFinished = (id: string) => !plannedIds.has(id) || reports.has(id)

  /** A step whose dependency failed (or was blocked itself) is reported as blocked. */
  const markBlocked = () => {
    let changed = true
    while (changed) {
      changed = false
      for (const [id, entry] of pending) {
        const dependencies = entry.step.dependsOn ?? []
        if (!dependencies.every(isFinished) || dependencies.every(isSatisfied)) continue
        pending.delete(id)
        finish(id, {
          startMs: elapsed(),
          commands: [],
          status: 'blocked',
          durationMs: 0,
          exitCode: null,
        })
        changed = true
      }
    }
  }

  const startReady = () => {
    const ready = [...pending.values()]
      .filter(({ step }) => (step.dependsOn ?? []).every(isSatisfied))
      .sort((left, right) => (priority.get(right.step.id) ?? 0) - (priority.get(left.step.id) ?? 0))
    for (const entry of ready) {
      if (active.size >= options.concurrency) return
      pending.delete(entry.step.id)
      active.set(
        entry.step.id,
        runStep(entry).finally(() => active.delete(entry.step.id)),
      )
    }
  }

  while ((pending.size > 0 || active.size > 0) && !run.interrupted) {
    markBlocked()
    startReady()
    if (active.size === 0) break
    await Promise.race(active.values())
  }
  await Promise.allSettled(active.values())
  if (options.cache) await writeStepCache(cache)
  const execution: Execution = { reports, interrupted: run.interrupted }
  return execution
}
