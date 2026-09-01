import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  bundledLanguages,
  bundledThemes,
  createHighlighterCore,
  createJavaScriptRegexEngine,
  createOnigurumaEngine,
  type HighlighterCore,
} from 'shiki'
import {
  analyzeSourceForView,
  MAX_SYNTAX_SOURCE_CODE_UNITS,
  sourceViewLineAt,
  syntaxHighlightAdmission,
  syntaxSourceFingerprint,
} from '../../src/shared/syntax-highlighting-performance'

// Twenty samples are the minimum useful population for a p95: smaller sets make p95 equal the
// single slowest sample and turn ordinary scheduler noise into a false regression.
const WARM_SAMPLE_COUNT = 20
const COLD_SAMPLE_COUNT = 20
const LARGE_TOKEN_SAMPLE_COUNT = 20
const KIBIBYTE = 1024
const SMALL_FIXTURE_BYTES = 16 * KIBIBYTE
const MEDIUM_FIXTURE_BYTES = 128 * KIBIBYTE
const LARGE_DOCUMENT_BYTES = KIBIBYTE * KIBIBYTE
const DEFAULT_PROFILE_PATH = path.resolve('performance/syntax-budgets/macos-arm64.json')
const MEDIAN_PERCENTILE = 0.5
const P95_PERCENTILE = 0.95
const DECIMAL_PLACES = 3
const SOURCE_VIEW_SAMPLE_LINES = 80
const JSON_INDENT_SPACES = 2

interface MetricSummary {
  readonly medianMs: number
  readonly p95Ms: number
  readonly samples: number
}

interface SyntaxBenchmarkProfile {
  readonly metricBudgetsMs: Readonly<Record<string, number>>
  readonly metricMedianBudgetsMs?: Readonly<Record<string, number>>
}

function fixture(targetBytes: number) {
  const line = 'export function value(input: number) { return input * 2 + 1 }\n'
  return line.repeat(Math.ceil(targetBytes / line.length)).slice(0, targetBytes)
}

function percentile(values: readonly number[], percentileValue: number) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)
  return sorted[index] ?? 0
}

function summary(values: readonly number[]): MetricSummary {
  return {
    medianMs: percentile(values, MEDIAN_PERCENTILE),
    p95Ms: percentile(values, P95_PERCENTILE),
    samples: values.length,
  }
}

async function measure(samples: number, operation: () => void | Promise<void>) {
  const values: number[] = []
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now()
    await operation()
    values.push(performance.now() - startedAt)
  }
  return summary(values)
}

async function highlighter(engine: 'javascript' | 'oniguruma') {
  const regexEngine =
    engine === 'javascript'
      ? createJavaScriptRegexEngine()
      : await createOnigurumaEngine(import('shiki/wasm'))
  return createHighlighterCore({
    langs: [await bundledLanguages.typescript()],
    themes: [await bundledThemes['dark-plus']()],
    engine: regexEngine,
  })
}

function tokenize(instance: HighlighterCore, source: string) {
  const result = instance.codeToTokens(source, { lang: 'typescript', theme: 'dark-plus' })
  if (result.tokens.length === 0) throw new Error('Benchmark tokenization returned no lines.')
}

async function coldTokenization(engine: 'javascript' | 'oniguruma', source: string) {
  return measure(COLD_SAMPLE_COUNT, async () => {
    const instance = await highlighter(engine)
    tokenize(instance, source)
    instance.dispose()
  })
}

async function warmTokenization(source: string, samples = WARM_SAMPLE_COUNT) {
  const instance = await highlighter('javascript')
  tokenize(instance, source)
  const result = await measure(samples, () => tokenize(instance, source))
  instance.dispose()
  return result
}

function isBudgetMap(value: unknown): value is Readonly<Record<string, number>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (budget) => typeof budget === 'number' && Number.isFinite(budget) && budget > 0,
    )
  )
}

function isProfile(value: unknown): value is SyntaxBenchmarkProfile {
  if (typeof value !== 'object' || value === null || !('metricBudgetsMs' in value)) return false
  const medianBudgets =
    'metricMedianBudgetsMs' in value ? value.metricMedianBudgetsMs : undefined
  return (
    isBudgetMap(value.metricBudgetsMs) &&
    (medianBudgets === undefined || isBudgetMap(medianBudgets))
  )
}

function benchmarkProfilePath() {
  const configuredPath = process.env.SYNTAX_BENCHMARK_PROFILE
  return configuredPath ? path.resolve(configuredPath) : DEFAULT_PROFILE_PATH
}

async function loadProfile(profilePath: string) {
  const parsed: unknown = JSON.parse(await fs.readFile(profilePath, 'utf8'))
  if (!isProfile(parsed)) throw new Error(`Invalid syntax benchmark profile: ${profilePath}`)
  return parsed
}

function roundSummary(metric: MetricSummary): MetricSummary {
  return {
    medianMs: Number(metric.medianMs.toFixed(DECIMAL_PLACES)),
    p95Ms: Number(metric.p95Ms.toFixed(DECIMAL_PLACES)),
    samples: metric.samples,
  }
}

async function main() {
  const small = fixture(SMALL_FIXTURE_BYTES)
  const medium = fixture(MEDIUM_FIXTURE_BYTES)
  const large = fixture(LARGE_DOCUMENT_BYTES)
  const admissionSource = fixture(MAX_SYNTAX_SOURCE_CODE_UNITS)
  const largeFingerprint = syntaxSourceFingerprint(large)
  const metrics = {
    javascriptCold16KiB: await coldTokenization('javascript', small),
    javascriptWarm16KiB: await warmTokenization(small),
    javascriptWarm128KiB: await warmTokenization(medium),
    javascriptWarm1MiB: await warmTokenization(large, LARGE_TOKEN_SAMPLE_COUNT),
    onigurumaCold16KiB: await coldTokenization('oniguruma', small),
    admissionScan1MiB: await measure(WARM_SAMPLE_COUNT, () => {
      if (!syntaxHighlightAdmission(admissionSource).admitted) {
        throw new Error('The admitted benchmark fixture was rejected.')
      }
    }),
    sourceWindow1MiB: await measure(WARM_SAMPLE_COUNT, () => {
      const analysis = analyzeSourceForView(large)
      const visible = analysis.lineStarts
        .slice(0, SOURCE_VIEW_SAMPLE_LINES)
        .map((_, index) => sourceViewLineAt(large, analysis.lineStarts, index))
      if (visible.length !== SOURCE_VIEW_SAMPLE_LINES)
        throw new Error('Source-view benchmark returned too few lines.')
    }),
    sourceFingerprint1MiB: await measure(WARM_SAMPLE_COUNT, () => {
      if (syntaxSourceFingerprint(large) !== largeFingerprint) {
        throw new Error('Source fingerprint benchmark returned an unstable identity.')
      }
    }),
  }
  const rounded = Object.fromEntries(
    Object.entries(metrics).map(([name, metric]) => [name, roundSummary(metric)]),
  )
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    hardware: { cpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
    fixtures: {
      smallBytes: small.length,
      mediumBytes: medium.length,
      largeDocumentBytes: large.length,
      admissionCodeUnits: admissionSource.length,
    },
    metrics: rounded,
  }
  process.stdout.write(`${JSON.stringify(report, null, JSON_INDENT_SPACES)}\n`)

  if (!process.argv.includes('--check')) return
  const profilePath = benchmarkProfilePath()
  const profile = await loadProfile(profilePath)
  const metricFailures = (
    budgets: Readonly<Record<string, number>>,
    field: 'medianMs' | 'p95Ms',
    label: 'median' | 'p95',
  ) =>
    Object.entries(budgets).flatMap(([name, budget]) => {
      const metric = Object.entries(metrics).find(([metricName]) => metricName === name)?.[1]
      if (!metric) return [`${name} is configured but was not measured`]
      return metric[field] > budget
        ? [`${name} ${label} ${metric[field].toFixed(DECIMAL_PLACES)} ms exceeded ${String(budget)} ms`]
        : []
    })
  const failures = [
    ...metricFailures(profile.metricBudgetsMs, 'p95Ms', 'p95'),
    ...metricFailures(profile.metricMedianBudgetsMs ?? {}, 'medianMs', 'median'),
  ]
  if (failures.length > 0) {
    throw new Error(
      `Syntax benchmark failed against ${path.relative(process.cwd(), profilePath)}:\n${failures.join('\n')}`,
    )
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
