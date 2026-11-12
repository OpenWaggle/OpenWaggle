/**
 * The Performance Gate's Markdown: the job summary and the one pull request comment
 * (perf-report.yml) show the same tables. Changed rows come first, then the unchanged ones folded
 * away; any raised limit and any accepting label is named above the tables.
 */
import type { BudgetRow } from './budget-compare'
import { BUDGET_INCREASE_LABEL } from './budget-compare'
import { PERF_BUDGET_METRICS } from './budget-metrics'
import type { TimingRow } from './ab-verdict'
import { REGRESSION_ACCEPTED_LABEL } from './ab-verdict'
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
  return `| \`${row.id}\` | ${amount(row.base, unit)} | ${amount(row.head, unit)} | ${delta}${relative} | ${amount(row.limit, unit)} | ${TIMING_STATUS_TEXT[row.status]} |`
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

function verdictLines(report: PerfGateReport) {
  const lines: string[] = []
  const budgets = report.budgets
  if (budgets && budgets.increases.length > 0) {
    lines.push(
      budgets.accepted
        ? `- Budgets: ${String(budgets.increases.length)} increase(s), accepted by \`${BUDGET_INCREASE_LABEL}\`.`
        : `- Budgets: ${String(budgets.increases.length)} increase(s). Fix them, or a maintainer adds \`${BUDGET_INCREASE_LABEL}\`.`,
    )
  }
  const timings = report.timings
  if (timings && (timings.regressions.length > 0 || timings.loosened.length > 0)) {
    lines.push(
      timings.accepted
        ? `- Timings: ${String(timings.regressions.length)} regression(s), accepted by \`${REGRESSION_ACCEPTED_LABEL}\`.`
        : `- Timings: ${String(timings.regressions.length)} regression(s). Fix them, or a maintainer adds \`${REGRESSION_ACCEPTED_LABEL}\`.`,
    )
  }
  const limits = raisedLimits(report)
  if (limits.length > 0) lines.push(`- Limits raised: ${limits.join('; ')}.`)
  return lines.length > 0 ? lines : ['- No budget increase and no timing regression.']
}

export function renderReport(report: PerfGateReport) {
  const budgetRows = report.budgets?.rows ?? []
  const timingRows = report.timings?.rows ?? []
  const changedBudgets = budgetRows.filter((row) => row.status !== 'same')
  const changedTimings = timingRows.filter(
    (row) => row.status === 'regressed' || row.status === 'improved',
  )
  const timingSection = report.timings
    ? table(
        ['Metric', 'Base median', 'Head median', 'Paired Δ', 'Limit', 'Result'],
        changedTimings.map(timingLine),
        timingRows.filter((row) => !changedTimings.includes(row)).map(timingLine),
      )
    : [report.timingsSkipped ? `Skipped: ${report.timingsSkipped}.` : 'Not measured.']
  const where = report.platform ? `, ${report.platform}` : ''
  const pairs = report.pairs === null ? '' : `, ${String(report.pairs)} interleaved pairs${where}`
  return [
    REPORT_MARKER,
    '## Performance Gate',
    '',
    `Base \`${report.baseSha.slice(0, SHORT_SHA)}\` (merge base) vs head \`${report.headSha.slice(0, SHORT_SHA)}\`.`,
    '',
    ...verdictLines(report),
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
    ...timingSection,
    '',
  ].join('\n')
}
