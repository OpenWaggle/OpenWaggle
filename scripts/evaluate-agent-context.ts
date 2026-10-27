/**
 * Agent-context evaluation (decision 7 of the v1 performance plan), modelled on
 * `evaluate-session-titles.ts`: about 25 script-graded tasks that a real model runs through a
 * packaged build in hidden automation, each repetition on a fresh throwaway profile.
 *
 *   pnpm evaluate:agent-context --app <OpenWaggle.app> --label beta27 \
 *     --model amazon-bedrock/eu.anthropic.claude-opus-5-5 --reps 5 --out <dir>
 *   pnpm evaluate:agent-context ... --out <dir> --baseline <baseline out dir>
 *
 * Bedrock models use the caller's AWS_PROFILE (and AWS_REGION); the user's ~/.aws is linked into
 * each throwaway home. Results append to `<out>/runs.jsonl`, so an interrupted evaluation resumes
 * where it stopped; `<out>/summary.json` holds pass counts, tokens and cost per task and group.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { resolvePerfApp } from './perf/lib/perf-app'
import { log, measurementEnvironment } from './perf/lib/perf-results'
import { type EvalRunRecord, runEvalTask } from './evaluate-agent-context-runner'
import { compareWithBaseline, summarizeEvalRuns } from './evaluate-agent-context-summary'
import { AGENT_CONTEXT_TASKS } from './evaluate-agent-context-tasks'

const DEFAULT_REPS = 5
const DEFAULT_CONCURRENCY = 3
const DECIMAL = 10
const JSON_INDENT = 2
const USAGE_EXIT_CODE = 2
const COST_DECIMALS = 3
const MILLISECONDS_PER_SECOND = 1_000
const FORWARDED_ENVIRONMENT = ['AWS_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'OPENROUTER_API_KEY'] as const

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    label: { type: 'string' },
    model: { type: 'string' },
    reps: { type: 'string' },
    tasks: { type: 'string' },
    concurrency: { type: 'string' },
    out: { type: 'string' },
    baseline: { type: 'string' },
  },
})

function forwardedEnvironment() {
  return Object.fromEntries(
    FORWARDED_ENVIRONMENT.flatMap((key) => {
      const value = process.env[key]
      return value ? [[key, value]] : []
    }),
  )
}

/** Runs recorded by this script: the summary only reads the fields it was written with. */
function isRunRecord(value: unknown): value is EvalRunRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'taskId') === 'string' &&
    typeof Reflect.get(value, 'rep') === 'number' &&
    typeof Reflect.get(value, 'pass') === 'boolean'
  )
}

async function completedRuns(file: string) {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line)
        return isRunRecord(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
}

async function runPool<Job>(jobs: readonly Job[], concurrency: number, work: (job: Job) => Promise<void>) {
  let next = 0
  const lanes = Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const job = jobs[next]
      next += 1
      if (job !== undefined) await work(job)
    }
  })
  await Promise.all(lanes)
}

async function main() {
  if (!values.app || !values.model || !values.out) {
    process.stderr.write('Use --app <OpenWaggle.app> --model <provider/model> --out <dir> [--reps 5] [--tasks a,b] [--baseline <dir>]\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const app = resolvePerfApp(values.app, values.label)
  const model = values.model
  const out = path.resolve(values.out)
  await mkdir(out, { recursive: true })
  const runsFile = path.join(out, 'runs.jsonl')
  const reps = Number.parseInt(values.reps ?? String(DEFAULT_REPS), DECIMAL)
  const wanted = values.tasks ? new Set(values.tasks.split(',')) : null
  const tasks = AGENT_CONTEXT_TASKS.filter((task) => !wanted || wanted.has(task.id))
  const done = await completedRuns(runsFile)
  const jobs = Array.from({ length: reps }, (_, rep) => tasks.map((task) => ({ task, rep }))).flat()
    .filter((job) => !done.some((run) => run.taskId === job.task.id && run.rep === job.rep))
  log(`${String(jobs.length)} runs to go (${String(done.length)} already recorded) on ${model}`)
  await runPool(jobs, Number.parseInt(values.concurrency ?? String(DEFAULT_CONCURRENCY), DECIMAL), async ({ task, rep }) => {
    try {
      const record = await runEvalTask({ app, task, rep, model, environment: forwardedEnvironment() })
      await appendFile(runsFile, `${JSON.stringify(record)}\n`)
      log(`${task.id} #${String(rep)}: ${record.pass ? 'pass' : 'FAIL'} (${record.reason}) ${String(record.totalTokens)} tok $${record.usage.costUsd.toFixed(COST_DECIMALS)} ${String(Math.round(record.wallMs / MILLISECONDS_PER_SECOND))}s`)
    } catch (error) {
      log(`${task.id} #${String(rep)} errored: ${String(error)}`)
    }
  })
  const summary = summarizeEvalRuns(await completedRuns(runsFile))
  const comparison = values.baseline
    ? compareWithBaseline(summarizeEvalRuns(await completedRuns(path.join(path.resolve(values.baseline), 'runs.jsonl'))), summary)
    : null
  const report = { kind: 'agent-context-eval', environment: measurementEnvironment(), app: app.label, model, reps, summary, comparison }
  await writeFile(path.join(out, 'summary.json'), `${JSON.stringify(report, null, JSON_INDENT)}\n`)
  process.stdout.write(`${JSON.stringify({ totals: summary.totals, groups: summary.groups, comparison }, null, JSON_INDENT)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
