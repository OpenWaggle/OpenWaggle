import path from 'node:path'
import { log, measurementEnvironment, writeJsonResult } from './perf-results'
import { summarizeRuns } from './perf-stats'

const ORDERS = 2
const JSON_INDENT = 2
const USAGE_EXIT_CODE = 2

export interface PerfAppComparison {
  /** `--app` values, one packaged app each. */
  readonly appPaths: readonly string[] | undefined
  /** `--label` values, matched to the apps by position; defaults to each app's file name. */
  readonly labels: readonly string[] | undefined
  readonly runs: number
  /** The word each progress line names the run with, such as `idle`. */
  readonly runName: string
  readonly measure: (appPath: string, label: string) => Promise<object>
  /** What a progress line shows of a result; the whole result by default. */
  readonly describe?: (result: object) => object
}

/**
 * Measures each packaged app `runs` times, alternating which app goes first so neither always
 * runs on a warmer machine, and keeps a failed run as an error entry. Exits with a usage error
 * when no app is given.
 */
export async function compareApps(input: PerfAppComparison) {
  const appPaths = input.appPaths ?? []
  if (appPaths.length === 0) {
    process.stderr.write('Use --app <OpenWaggle.app> (repeatable) (macOS only)\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const indexed = appPaths.map((appPath, index) => ({
    appPath,
    label: input.labels?.[index] ?? path.basename(appPath),
  }))
  const results: Record<string, object[]> = Object.fromEntries(
    indexed.map((entry) => [entry.label, []]),
  )
  for (let run = 0; run < input.runs; run += 1) {
    for (const entry of run % ORDERS === 0 ? indexed : [...indexed].reverse()) {
      const attempt = `${entry.label} ${input.runName} ${String(run + 1)}`
      try {
        const result = await input.measure(entry.appPath, entry.label)
        results[entry.label]?.push(result)
        log(`${attempt}: ${JSON.stringify(input.describe ? input.describe(result) : result)}`)
      } catch (error) {
        results[entry.label]?.push({ error: String(error) })
        log(`${attempt} failed: ${String(error)}`)
      }
    }
  }
  return results
}

/** Summarizes compared runs, writes the report to `outDirectory` when given, and prints the summary. */
export async function reportComparison(input: {
  readonly results: Record<string, object[]>
  readonly metrics: readonly string[]
  readonly kind: string
  readonly details: object
  readonly outDirectory: string | undefined
  readonly fileName: string
}) {
  const summary = Object.fromEntries(
    Object.entries(input.results).map(([label, entries]) => [
      label,
      summarizeRuns(entries, input.metrics),
    ]),
  )
  const report = {
    kind: input.kind,
    environment: measurementEnvironment(),
    ...input.details,
    summary,
    results: input.results,
  }
  if (input.outDirectory) {
    log(`Wrote ${await writeJsonResult(input.outDirectory, input.fileName, report)}`)
  }
  process.stdout.write(`${JSON.stringify(summary, null, JSON_INDENT)}\n`)
}
