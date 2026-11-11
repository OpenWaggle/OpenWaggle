/**
 * What a run reports: .tmp/check/report.json, the one-line summary and the failure output.
 */
import { readFile } from 'node:fs/promises'
import { capFindings, parseFindings } from './findings'
import type { CheckGate, CheckStep } from './step-model'

export const CHECK_OUTPUT_DIRECTORY = '.tmp/check'
export const REPORT_FILE = `${CHECK_OUTPUT_DIRECTORY}/report.json`
const MILLISECONDS_PER_SECOND = 1000

export type StepStatus = 'passed' | 'failed' | 'cached' | 'blocked' | 'unchanged'

export interface StepReport {
  readonly id: string
  readonly status: StepStatus
  /** Offset from the start of the run. */
  readonly startMs: number
  readonly durationMs: number
  readonly exitCode: number | null
  readonly log: string
  readonly commands: readonly string[]
  /** An advisory step's findings, which fail nothing (`CheckStep.advisory`). */
  readonly advisories?: readonly string[]
}

export interface RunReport {
  readonly gate: string
  readonly ok: boolean
  readonly startedAt: string
  readonly durationMs: number
  readonly concurrency: number
  readonly cores: number
  readonly loadAverage: readonly number[]
  readonly changedOnly: boolean
  readonly steps: readonly StepReport[]
}

export function logPath(id: string) {
  return `${CHECK_OUTPUT_DIRECTORY}/${id.replaceAll(':', '-')}.log`
}

export function seconds(milliseconds: number) {
  return `${(milliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`
}

/** `check: 20 steps passed in 41.2s`, or which steps failed. */
export function summaryLine(gate: string, reports: readonly StepReport[], durationMs: number) {
  const count = (status: StepStatus) => reports.filter((report) => report.status === status).length
  const failed = reports.filter((report) => report.status === 'failed')
  const cached = count('cached')
  const unchanged = count('unchanged')
  const extras = [
    cached > 0 ? `${cached} cached` : '',
    unchanged > 0 ? `${unchanged} with no changed files` : '',
  ].filter(Boolean)
  const suffix = extras.length === 0 ? '' : ` (${extras.join(', ')})`
  if (failed.length === 0) {
    return `${gate}: ${reports.length - unchanged} steps passed in ${seconds(durationMs)}${suffix}`
  }
  const blocked = count('blocked')
  const notRun = blocked > 0 ? `; ${blocked} not run` : ''
  const ids = failed.map((report) => report.id).join(', ')
  return `${gate}: ${failed.length} of ${reports.length} steps failed (${ids}) in ${seconds(durationMs)}${notRun}`
}

/** The failed step's header, its findings (capped), and the fix hint. */
export async function failureOutput(step: CheckStep, report: StepReport) {
  const log = await readFile(report.log, 'utf8').catch(() => '')
  const findings = capFindings(parseFindings(step.findings, log), report.log)
  return [
    `FAIL ${step.id} (${seconds(report.durationMs)}, exit ${String(report.exitCode)}, log ${report.log})`,
    ...findings,
    `fix: ${step.hint}`,
  ]
}

export function formatStepList(
  gate: CheckGate,
  gates: readonly CheckGate[],
  selected: readonly CheckStep[],
) {
  const width = Math.max(...selected.map((step) => step.id.length))
  const lines = [`${gate.id}: ${gate.summary}`]
  for (const step of selected) {
    const after = step.dependsOn ?? []
    const dependencies = after.length === 0 ? '' : ` (after ${after.join(', ')})`
    const changed = step.changedFiles === undefined ? '' : ' [--changed]'
    lines.push(`  ${step.id.padEnd(width)}  ${step.summary}${dependencies}${changed}`)
  }
  lines.push(`gates: ${gates.map((entry) => entry.id).join(', ')}`)
  return lines.join('\n')
}

/** Step durations from a report, skipping cached ones (they say nothing about the real cost). */
export function reportDurations(report: unknown) {
  const durations = new Map<string, number>()
  const steps: unknown =
    report !== null && typeof report === 'object' ? Reflect.get(report, 'steps') : undefined
  if (!Array.isArray(steps)) return durations
  for (const entry of steps) {
    if (entry === null || typeof entry !== 'object') continue
    const id: unknown = Reflect.get(entry, 'id')
    const duration: unknown = Reflect.get(entry, 'durationMs')
    const status: unknown = Reflect.get(entry, 'status')
    if (typeof id !== 'string' || typeof duration !== 'number' || status === 'cached') continue
    durations.set(id, duration)
  }
  return durations
}

/** An advisory step's findings: the lines of its log. */
export async function advisoryFindings(report: StepReport) {
  const log = await readFile(report.log, 'utf8').catch(() => '')
  return log
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
}

/** The advisory header and findings (capped), or nothing when the step had nothing to say. */
export function advisoryOutput(step: CheckStep, report: StepReport) {
  const findings = report.advisories ?? []
  if (findings.length === 0) return []
  return [
    `ADVISORY ${step.id} (fails nothing; log ${report.log})`,
    ...capFindings(findings, report.log),
    `note: ${step.hint}`,
  ]
}
