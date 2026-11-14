/**
 * The Performance Gate's Markdown: the job summary and the one pull request comment
 * (perf-report.yml) show the same tables. Changed rows come first, then the unchanged ones folded
 * away; any raised limit, any accepting label and any reason timings could not be judged is named
 * above the tables. Only budgets can fail the check; timings and memory are reported only.
 */
import type { BudgetRow } from './budget-compare'
import { BUDGET_INCREASE_LABEL } from './budget-compare'
import { PERF_BUDGET_METRICS } from './budget-metrics'
import type { TimingRow } from './ab-compare'
import { isTimingRegression, isUnmeasuredReadiness } from './ab-compare'
import type { PerfGateReport } from './report-data'

/** Finds the gate's comment among a pull request's comments. */
export const REPORT_MARKER = '<!-- openwaggle-performance-gate -->'

const KIBIBYTE = 1024
const MEBIBYTE = KIBIBYTE * KIBIBYTE
const PERCENT = 100
const SHORT_SHA = 9
const DECIMALS = 1

function bytes(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude >= MEBIBYTE) return `${(value / MEBIBYTE).toFixed(DECIMALS)} MiB`
  if (magnitude >= KIBIBYTE) return `${(value / KIBIBYTE).toFixed(DECIMALS)} KiB`
  return `${String(value)} B`
}

function amount(value: number | null, unit: 'bytes' | 'count' | 'ms') {
  if (value === null) return '–'
  if (unit === 'bytes') return bytes(value)
  if (unit === 'ms') return `${String(Math.round(value))} ms`
  return String(Math.round(value * PERCENT) / PERCENT)
}

function signed(text: string, value: number) {
  return value > 0 ? `+${text}` : text
}

const BUDGET_STATUS_TEXT: Readonly<Record<BudgetRow['status'], string>> = {
  raised: '🔺 raised',
  lowered: '✅ lower',
  same: 'same',
  new: 'new',
  removed: '🔺 removed',
  'quantum-raised': '🔺 coarser quantum',
  'quantum-lowered': 'finer quantum',
}

const TIMING_STATUS_TEXT: Readonly<Record<TimingRow['status'], string>> = {
  regressed: '🔺 slower or heavier',
  missing: '🔺 not measured on the head',
  improved: '✅ better',
  same: 'within noise',
  unavailable: 'not measured',
}

function budgetTitle(id: string) {
  return PERF_BUDGET_METRICS.find((metric) => metric.id === id)?.title ?? id
}

function budgetLine(row: BudgetRow) {
  const unit = row.unit === 'bytes' ? 'bytes' : 'count'
  const delta =
    row.base !== null && row.head !== null
      ? signed(amount(row.head - row.base, unit), row.head - row.base)
      : '–'
  return `| ${budgetTitle(row.id)} (\`${row.id}\`) | ${amount(row.base, unit)} | ${amount(row.head, unit)} | ${delta} | ${BUDGET_STATUS_TEXT[row.status]} |`
}

function timingUnit(row: TimingRow) {
  if (row.kind === 'timing') return 'ms'
  return row.kind === 'memory' ? 'bytes' : 'count'
}

function timingLine(row: TimingRow) {
  const unit = timingUnit(row)
  const delta = row.delta === null ? '–' : signed(amount(row.delta, unit), row.delta)
  const relative =
    row.relative === null
      ? ''
      : ` (${signed((row.relative * PERCENT).toFixed(DECIMALS), row.relative)}%)`
  return `| \`${row.id}\` | ${amount(row.base, unit)} | ${amount(row.head, unit)} | ${delta}${relative} | ${amount(row.limit, unit)} | ${isUnmeasuredReadiness(row) ? '🔺 not measured on either side' : TIMING_STATUS_TEXT[row.status]} |`
}

function table(
  header: readonly string[],
  changed: readonly string[],
  unchanged: readonly string[],
) {
  const head = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
  const lines = changed.length > 0 ? [...head, ...changed] : ['No changes.']
  if (unchanged.length > 0) {
    lines.push(
      '',
      `<details><summary>${String(unchanged.length)} unchanged</summary>`,
      '',
      ...head,
      ...unchanged,
      '',
      '</details>',
    )
  }
  return lines
}

function raisedLimits(report: PerfGateReport) {
  const budgetLimits = (report.budgets?.rows ?? [])
    .filter((row) => row.status === 'quantum-raised' || row.status === 'removed')
    .map((row) =>
      row.status === 'removed'
        ? `budget \`${row.id}\` removed`
        : `budget \`${row.id}\` quantum ${String(row.baseQuantum)} → ${String(row.headQuantum)}`,
    )
  const thresholds = (report.timings?.loosened ?? []).map(
    (change) =>
      `timing threshold \`${change.name}\` ${String(change.base)} → ${String(change.head)}`,
  )
  return [...budgetLimits, ...thresholds]
}

const REPORTED_ONLY = 'Timings are reported only and never fail this check'

function budgetLines(report: PerfGateReport) {
  const budgets = report.budgets
  if (budgets === null) return ['- Budgets were not compared.']
  if (budgets.increases.length === 0) return []
  return [
    budgets.accepted
      ? `- Budgets: ${String(budgets.increases.length)} increase(s), accepted by \`${BUDGET_INCREASE_LABEL}\`.`
      : `- 🔺 Budgets: ${String(budgets.increases.length)} increase(s) fail this check. Fix them, or a maintainer adds \`${BUDGET_INCREASE_LABEL}\` and re-runs the check.`,
  ]
}

function timingLines(report: PerfGateReport) {
  if (report.timingsUnavailable !== null) {
    return [
      `- ⚠️ Timings unavailable: ${report.timingsUnavailable}. ${REPORTED_ONLY}; re-run the timing job to measure them.`,
    ]
  }
  const timings = report.timings
  if (timings === null) return []
  const lines: string[] = []
  if (timings.incomplete.length > 0) {
    lines.push(
      `- ⚠️ Timings cannot be judged: ${timings.incomplete.join(' ')} ${REPORTED_ONLY}; re-run the timing job to measure them.`,
    )
  }
  if (timings.regressions.length > 0) {
    const ids = timings.regressions.map((row) => `\`${row.id}\``).join(', ')
    lines.push(
      `- 🔺 Timings: ${String(timings.regressions.length)} regression(s): ${ids}. ${REPORTED_ONLY}; reproduce with \`bun run perf:ab\`.`,
    )
  }
  return lines
}

function summaryLines(report: PerfGateReport) {
  const lines = [...budgetLines(report), ...timingLines(report)]
  const limits = raisedLimits(report)
  if (limits.length > 0) lines.push(`- Limits raised: ${limits.join('; ')}.`)
  return lines.length > 0 ? lines : ['- No budget increase and no timing regression.']
}

function timingSection(report: PerfGateReport) {
  const rows = report.timings?.rows ?? []
  if (report.timings === null || rows.length === 0) {
    if (report.timingsSkipped !== null) return [`Skipped: ${report.timingsSkipped}.`]
    if (report.timingsUnavailable !== null) return [`Unavailable: ${report.timingsUnavailable}.`]
    return ['Not measured.']
  }
  const changed = rows.filter((row) => isTimingRegression(row) || row.status === 'improved')
  return table(
    ['Metric', 'Base median', 'Head median', 'Paired Δ', 'Limit', 'Result'],
    changed.map(timingLine),
    rows.filter((row) => !changed.includes(row)).map(timingLine),
  )
}

export function renderReport(report: PerfGateReport) {
  const budgetRows = report.budgets?.rows ?? []
  const changedBudgets = budgetRows.filter((row) => row.status !== 'same')
  const where = report.platform ? `, ${report.platform}` : ''
  const pairs = report.pairs === null ? '' : `, ${String(report.pairs)} interleaved pairs${where}`
  return [
    REPORT_MARKER,
    '## Performance Gate',
    '',
    `Base \`${report.baseSha.slice(0, SHORT_SHA)}\` (merge base) vs head \`${report.headSha.slice(0, SHORT_SHA)}\`.`,
    '',
    `Only budgets can fail this check, and \`${BUDGET_INCREASE_LABEL}\` accepts a raise. Timings and memory are noisy, so they are reported only.`,
    '',
    ...summaryLines(report),
    '',
    '### Budgets (performance/perf-budgets.json vs main)',
    '',
    ...table(
      ['Metric', 'Main', 'This PR', 'Δ', 'Result'],
      changedBudgets.map(budgetLine),
      budgetRows.filter((row) => row.status === 'same').map(budgetLine),
    ),
    '',
    `### Timings and memory (built app, A/B${pairs})`,
    '',
    ...timingSection(report),
    '',
  ].join('\n')
}
