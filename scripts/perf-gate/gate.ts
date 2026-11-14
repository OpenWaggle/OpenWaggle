/**
 * The Performance Gate's workflow commands (.github/workflows/perf-gate.yml):
 *
 *   decide --base <sha> --head <sha>          whether the timing job runs (changed-paths.ts)
 *   budgets --base <main's file> --head <the PR's file> [--labels a,b] --out <json>
 *                                             performance/perf-budgets.json against main's (budget-compare.ts)
 *   labels --repo <owner/name> --pr <number> --run <workflow run id>
 *                                             the gate labels a maintainer added since the run was created
 *   verdict --results <ab.json> --thresholds <main's> --head-thresholds <the PR's> [--labels a,b] --out <json>
 *   report --base-sha <sha> --head-sha <sha> [--pr n] [--budgets <json>] [--verdict <json>]
 *          [--results <ab.json>] [--skipped <reason>] [--labels a,b] --out <json> --markdown <md>
 *   render --report <json> --markdown <md>    the comment, from a report another run wrote
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parseJsonUnknown } from '@shared/schema'
import type { AbResults } from './ab-run'
import { REGRESSION_ACCEPTED_LABEL, type Thresholds, timingVerdict } from './ab-verdict'
import { BUDGET_INCREASE_LABEL, budgetFailureLines, compareBudgets } from './budget-compare'
import { type PerfBudgetFile, parsePerfBudgetFile } from './budget-file'
import { PERF_BUDGET_METRICS } from './budget-metrics'
import { timingDecision } from './changed-paths'
import { parsePerfGateReport } from './report-data'
import { renderReport } from './report-markdown'
import { abFailureLines, parseAbResults, parseThresholds } from './gate-files'

const FIRST_ARGUMENT = 2
const JSON_INDENT = 2
const GATE_LABELS = [BUDGET_INCREASE_LABEL, REGRESSION_ACCEPTED_LABEL]
/** Repository roles that may accept a regression. */
const MAINTAINER_ROLES: ReadonlySet<string> = new Set(['admin', 'maintain'])

const OPTIONS = {
  base: { type: 'string' },
  head: { type: 'string' },
  repo: { type: 'string' },
  pr: { type: 'string' },
  run: { type: 'string' },
  results: { type: 'string' },
  thresholds: { type: 'string' },
  'head-thresholds': { type: 'string' },
  labels: { type: 'string', default: '' },
  out: { type: 'string' },
  'base-sha': { type: 'string' },
  'head-sha': { type: 'string' },
  budgets: { type: 'string' },
  verdict: { type: 'string' },
  skipped: { type: 'string' },
  report: { type: 'string' },
  markdown: { type: 'string' },
} as const

/** The options a command reads; `parseArgs` fills only those given. */
type GateValues = { readonly [Name in keyof typeof OPTIONS]?: string | undefined }

function readJson(file: string) {
  return parseJsonUnknown(fs.readFileSync(file, 'utf8'))
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`)
}

function required(value: string | undefined, name: string) {
  if (value === undefined || value === '') throw new Error(`--${name} is required.`)
  return value
}

function labelList(value: string) {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '')
}

/** `gh api` with these arguments, returning its output. */
export type GhApi = (args: readonly string[]) => string

const ghApi: GhApi = (args) => execFileSync('gh', ['api', ...args], { encoding: 'utf8' })

/** When this workflow run's first attempt was created; a re-run keeps it, a new push does not. */
function runCreatedAt(repo: string, runId: string, gh: GhApi) {
  const createdAt = Date.parse(
    gh([`repos/${repo}/actions/runs/${runId}/attempts/1`, '--jq', '.created_at']).trim(),
  )
  if (Number.isNaN(createdAt)) throw new Error(`Workflow run ${runId} has no creation time.`)
  return createdAt
}

/** Each `labeled` event on the pull request, oldest first. */
function labeledEvents(repo: string, pr: string, gh: GhApi) {
  return gh([
    '--paginate',
    `repos/${repo}/issues/${pr}/events`,
    '--jq',
    '.[] | select(.event == "labeled") | [.label.name, .actor.login, .created_at] | @tsv',
  ])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [label = '', actor = '', createdAt = ''] = line.split('\t')
      return { label, actor, createdAt: Date.parse(createdAt) }
    })
}

/**
 * The gate labels on the pull request now, each kept only if a maintainer last added it after this
 * workflow run was first created: a label accepts the push it was added for, never a later one, so a
 * new push needs labelling again. Re-running the run's failed job keeps its creation time.
 */
export function maintainerLabels(repo: string, pr: string, runId: string, gh: GhApi = ghApi) {
  const present = labelList(
    gh([`repos/${repo}/issues/${pr}/labels`, '--jq', '[.[].name] | join(",")']).trim(),
  )
  const wanted = GATE_LABELS.filter((label) => present.includes(label))
  if (wanted.length === 0) return []
  const since = runCreatedAt(repo, runId, gh)
  const events = labeledEvents(repo, pr, gh)
  return wanted.filter((label) => {
    const added = events.findLast((event) => event.label === label)
    if (added === undefined || added.actor === '' || !(added.createdAt > since)) return false
    const role = gh([
      `repos/${repo}/collaborators/${added.actor}/permission`,
      '--jq',
      '.role_name',
    ]).trim()
    return MAINTAINER_ROLES.has(role)
  })
}

function verdict(values: GateValues) {
  const results = parseAbResults(readJson(required(values.results, 'results')))
  const thresholds: Thresholds = parseThresholds(
    readJson(required(values.thresholds, 'thresholds')),
  )
  const headThresholds = parseThresholds(
    readJson(required(values['head-thresholds'], 'head-thresholds')),
  )
  const outcome = timingVerdict({
    results,
    thresholds,
    headThresholds,
    labels: labelList(values.labels ?? ''),
  })
  writeJson(required(values.out, 'out'), outcome)
  for (const line of abFailureLines(outcome, results)) console.error(line)
  return outcome.passed ? 0 : 1
}

/** main's file; none before the gate landed on main, which compares every metric as new. */
function budgetFile(file: string) {
  if (!fs.existsSync(file)) {
    const none: PerfBudgetFile = { about: '', metrics: {} }
    return none
  }
  return parsePerfBudgetFile(fs.readFileSync(file, 'utf8'), file)
}

function budgets(values: GateValues) {
  const comparison = compareBudgets({
    base: budgetFile(required(values.base, 'base')),
    head: budgetFile(required(values.head, 'head')),
    metrics: PERF_BUDGET_METRICS,
    labels: labelList(values.labels ?? ''),
  })
  writeJson(required(values.out, 'out'), comparison)
  for (const line of budgetFailureLines(comparison)) console.error(line)
  return comparison.passed ? 0 : 1
}

function report(values: GateValues) {
  const results: AbResults | null = values.results ? parseAbResults(readJson(values.results)) : null
  const parsed = parsePerfGateReport({
    baseSha: required(values['base-sha'], 'base-sha'),
    headSha: required(values['head-sha'], 'head-sha'),
    pullRequest: values.pr ? Number(values.pr) : null,
    timingsSkipped: values.skipped ?? null,
    labels: labelList(values.labels ?? ''),
    budgets: values.budgets ? readJson(values.budgets) : null,
    timings: values.verdict ? readJson(values.verdict) : null,
    pairs: results?.pairs ?? null,
    platform: results ? `${results.platform}-${results.arch}` : null,
  })
  if (parsed === null) throw new Error('The report is malformed.')
  writeJson(required(values.out, 'out'), parsed)
  fs.writeFileSync(required(values.markdown, 'markdown'), renderReport(parsed))
  return 0
}

function render(values: GateValues) {
  const parsed = parsePerfGateReport(readJson(required(values.report, 'report')))
  if (parsed === null) throw new Error('The report artifact is malformed; nothing to post.')
  fs.writeFileSync(required(values.markdown, 'markdown'), renderReport(parsed))
  return 0
}

export function main(argv: readonly string[]) {
  const [command, ...rest] = argv
  const { values } = parseArgs({ args: rest, options: OPTIONS })
  if (command === 'decide') {
    const base = required(values.base, 'base')
    const head = required(values.head, 'head')
    const files = execFileSync('git', ['diff', '--name-only', '--no-renames', base, head], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '')
    const decision = timingDecision(files)
    console.log(`run=${String(decision.run)}`)
    console.log(`reason=${decision.reason}`)
    return 0
  }
  if (command === 'labels') {
    console.log(
      `labels=${maintainerLabels(required(values.repo, 'repo'), required(values.pr, 'pr'), required(values.run, 'run')).join(',')}`,
    )
    return 0
  }
  if (command === 'budgets') return budgets(values)
  if (command === 'verdict') return verdict(values)
  if (command === 'report') return report(values)
  if (command === 'render') return render(values)
  throw new Error('Usage: see the header of scripts/perf-gate/gate.ts.')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(FIRST_ARGUMENT))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
