/**
 * Writes the last check run's step timings (.tmp/check/report.json) and output tokens
 * (.tmp/check/output-tokens.json) as a Markdown table to the GitHub job summary, or to stdout
 * outside Actions. On Actions each located advisory also becomes a notice annotation.
 *
 *   bun scripts/check/job-summary.ts
 */
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { readJsonFile } from './cache'
import { OUTPUT_TOKENS_FILE } from './output-budget'
import { REPORT_FILE, seconds } from './report'
import { scriptEnv } from '../support/env'

const LOAD_DECIMALS = 2

interface SummaryStep {
  readonly id: string
  readonly status: string
  readonly startMs: number
  readonly durationMs: number
}

function field(record: unknown, key: string) {
  const result: unknown =
    record !== null && typeof record === 'object' ? Reflect.get(record, key) : undefined
  return result
}

function numberField(record: unknown, key: string) {
  const value = field(record, key)
  return typeof value === 'number' ? value : 0
}

function summarySteps(report: unknown) {
  const steps = field(report, 'steps')
  if (!Array.isArray(steps)) return [] satisfies SummaryStep[]
  return steps.map((step: unknown) => ({
    id: String(field(step, 'id')),
    status: String(field(step, 'status')),
    startMs: numberField(step, 'startMs'),
    durationMs: numberField(step, 'durationMs'),
  })) satisfies SummaryStep[]
}

export function renderJobSummary(report: unknown, tokens: unknown) {
  if (report === undefined) return `### check\n\nNo ${REPORT_FILE}: the runner did not start.\n`
  const steps = summarySteps(report).sort((left, right) => right.durationMs - left.durationMs)
  const load = field(report, 'loadAverage')
  const loadText = Array.isArray(load)
    ? load.map((value) => Number(value).toFixed(LOAD_DECIMALS)).join(' ')
    : ''
  const tokenCount = field(tokens, 'tokens')
  const budget = field(tokens, 'budget')
  const lines = [
    `### ${String(field(report, 'gate'))}: ${field(report, 'ok') === true ? 'passed' : 'failed'} in ${seconds(numberField(report, 'durationMs'))}`,
    '',
    `Concurrency ${numberField(report, 'concurrency')} on ${numberField(report, 'cores')} cores, load ${loadText}.` +
      (typeof tokenCount === 'number'
        ? ` Output: ${tokenCount} o200k tokens (budget ${String(budget)}).`
        : ''),
    '',
    '| Step | Status | Starts at | Duration |',
    '| --- | --- | ---: | ---: |',
    ...steps.map(
      (step) =>
        `| ${step.id} | ${step.status} | ${seconds(step.startMs)} | ${seconds(step.durationMs)} |`,
    ),
  ]
  const advisories = summaryAdvisories(report)
  if (advisories.length > 0) {
    lines.push('', '#### Advisories (fail nothing)', '', ...advisories.map((line) => `- ${line}`))
  }
  return `${lines.join('\n')}\n`
}

function summaryAdvisories(report: unknown) {
  const steps = field(report, 'steps')
  if (!Array.isArray(steps)) return []
  return steps.flatMap((step: unknown) => {
    const advisories = field(step, 'advisories')
    return Array.isArray(advisories) ? advisories.map(String) : []
  })
}

const LOCATED_ADVISORY = /^(?<file>[^\s:]+):(?<line>\d+)(?::\d+)?\s+(?<message>.*)$/u

/** GitHub workflow commands that show each located advisory as a notice on its file. */
export function advisoryAnnotations(report: unknown) {
  return summaryAdvisories(report).flatMap((line) => {
    const groups = LOCATED_ADVISORY.exec(line)?.groups
    if (groups === undefined) return []
    const { file, line: lineNumber, message = '' } = groups
    const escaped = message.replaceAll('%', '%25').replaceAll('\n', '%0A')
    return [`::notice file=${String(file)},line=${String(lineNumber)}::${escaped}`]
  })
}

async function main() {
  const report = await readJsonFile(REPORT_FILE)
  const markdown = renderJobSummary(report, await readJsonFile(OUTPUT_TOKENS_FILE))
  const target = scriptEnv().GITHUB_STEP_SUMMARY
  if (target === undefined || target === '') {
    process.stdout.write(markdown)
    return
  }
  await appendFile(target, markdown)
  for (const annotation of advisoryAnnotations(report)) console.log(annotation)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`job-summary: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
