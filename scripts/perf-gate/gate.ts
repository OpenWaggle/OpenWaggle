/**
 * The Performance Gate's workflow commands (.github/workflows/perf-gate.yml):
 *
 *   decide --base <sha> --head <sha>          whether the timing job runs (changed-paths.ts)
 *   budgets --base <main's file> --head <the PR's file> [--labels a,b] --out <json>
 *                                             performance/perf-budgets.json against main's (budget-compare.ts)
 *   labels --repo <owner/name> --pr <number>  the gate labels a maintainer added (live, not the event's)
 *   verdict --results <ab.json> --thresholds <main's> --head-thresholds <the PR's> [--labels a,b] --out <json>
 *   report --base-sha <sha> --head-sha <sha> [--pr n] [--budgets <json>] [--verdict <json>]
 *          [--results <ab.json>] [--skipped <reason>] [--labels a,b] --out <json> --markdown <md>
 *   render --report <json> --markdown <md>    the comment, from a report another run wrote
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
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

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
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

function gh(args: readonly string[]) {
  return execFileSync('gh', ['api', ...args], { encoding: 'utf8' })
}

/** The gate labels on the pull request now, each kept only if a maintainer last added it. */
function maintainerLabels(repo: string, pr: string) {
  const present = labelList(
    gh([`repos/${repo}/issues/${pr}/labels`, '--jq', '[.[].name] | join(",")']).trim(),
  )
  return GATE_LABELS.filter((label) => present.includes(label)).filter((label) => {
    const actor = gh([
      '--paginate',
      `repos/${repo}/issues/${pr}/events`,
      '--jq',
      `[.[] | select(.event == "labeled" and .label.name == "${label}") | .actor.login] | last // ""`,
    ])
      .trim()
      .split('\n')
      .findLast((line) => line !== '')
    if (actor === undefined) return false
    const role = gh([
      `repos/${repo}/collaborators/${actor}/permission`,
      '--jq',
      '.role_name',
    ]).trim()
    return MAINTAINER_ROLES.has(role)
  })
}

function verdict(values: Record<string, string | undefined>) {
  const results = parseAbResults(readJson(required(values['results'], 'results')))
  const thresholds: Thresholds = parseThresholds(
    readJson(required(values['thresholds'], 'thresholds')),
  )
  const headThresholds = parseThresholds(
    readJson(required(values['head-thresholds'], 'head-thresholds')),
  )
  const outcome = timingVerdict({
    results,
    thresholds,
    headThresholds,
    labels: labelList(values['labels'] ?? ''),
  })
  writeJson(required(values['out'], 'out'), outcome)
  for (const line of abFailureLines(outcome, results)) console.error(line)
  return outcome.passed ? 0 : 1
}

/** main's file; none before the gate landed on main, which compares every metric as new. */
function budgetFile(file: string): PerfBudgetFile {
  if (!fs.existsSync(file)) return { about: '', metrics: {} }
  return parsePerfBudgetFile(fs.readFileSync(file, 'utf8'), file)
}

function budgets(values: Record<string, string | undefined>) {
  const comparison = compareBudgets({
    base: budgetFile(required(values['base'], 'base')),
    head: budgetFile(required(values['head'], 'head')),
    metrics: PERF_BUDGET_METRICS,
    labels: labelList(values['labels'] ?? ''),
  })
  writeJson(required(values['out'], 'out'), comparison)
  for (const line of budgetFailureLines(comparison)) console.error(line)
  return comparison.passed ? 0 : 1
}

function report(values: Record<string, string | undefined>) {
  const results: AbResults | null = values['results']
    ? parseAbResults(readJson(values['results']))
    : null
  const parsed = parsePerfGateReport({
    baseSha: required(values['base-sha'], 'base-sha'),
    headSha: required(values['head-sha'], 'head-sha'),
    pullRequest: values['pr'] ? Number(values['pr']) : null,
    timingsSkipped: values['skipped'] ?? null,
    labels: labelList(values['labels'] ?? ''),
    budgets: values['budgets'] ? readJson(values['budgets']) : null,
    timings: values['verdict'] ? readJson(values['verdict']) : null,
    pairs: results?.pairs ?? null,
    platform: results ? `${results.platform}-${results.arch}` : null,
  })
  if (parsed === null) throw new Error('The report is malformed.')
  writeJson(required(values['out'], 'out'), parsed)
  fs.writeFileSync(required(values['markdown'], 'markdown'), renderReport(parsed))
  return 0
}

function render(values: Record<string, string | undefined>) {
  const parsed = parsePerfGateReport(readJson(required(values['report'], 'report')))
  if (parsed === null) throw new Error('The report artifact is malformed; nothing to post.')
  fs.writeFileSync(required(values['markdown'], 'markdown'), renderReport(parsed))
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
      `labels=${maintainerLabels(required(values.repo, 'repo'), required(values.pr, 'pr')).join(',')}`,
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
