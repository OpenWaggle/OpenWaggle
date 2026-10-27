/**
 * Launch-time gates of the v1 performance plan, measured on packaged builds in hidden automation
 * with throwaway profiles: cold and warm launch to first paint, Session list and chat, renderer
 * LCP, and `openwaggle --version`. Several `--app` builds are interleaved run by run.
 *
 *   pnpm perf:startup --app <before.app> --app <after.app> --runs 10 --mode cold --out <dir>
 *   pnpm perf:startup --app <OpenWaggle.app> --mode warm --template <large-profile> \
 *     --session-list-text "Perf ·"
 *   pnpm perf:startup --app <OpenWaggle.app> --mode version --runs 10
 *
 * `--template` is a generated profile root (`pnpm perf:generate-profile`). Each build first opens
 * its own copy once (`<template>.warm-<label>`); that copy's `user-data` and `home` are then cloned
 * for every launch, so no launch sees another's state.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { LAUNCH_METRICS, type LaunchMode, measureLaunch } from './lib/launch-measurement'
import { type PerfApp, resolvePerfApp } from './lib/perf-app'
import { log, measurementEnvironment, writeJsonResult, exitWhenFlushed } from './lib/perf-results'
import { summarizeRuns } from './lib/perf-stats'
import { warmTemplateFor } from './lib/warm-template'

const DEFAULT_RUNS = 10
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_WARM_HOST_IDLE_MS = 4_000
const DEFAULT_SETTLE_MS = 1_500
const DECIMAL = 10
const USAGE_EXIT_CODE = 2
const JSON_INDENT = 2
const ORDERS = 2
const LOGGED_RESULT_CHARS = 400

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    runs: { type: 'string' },
    mode: { type: 'string', default: 'cold' },
    template: { type: 'string' },
    'session-list-text': { type: 'string' },
    'timeout-ms': { type: 'string' },
    'warm-host-idle-ms': { type: 'string' },
    out: { type: 'string' },
  },
})

function numberOption(raw: string | undefined, fallback: number) {
  const parsed = raw === undefined ? fallback : Number.parseInt(raw, DECIMAL)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid number: ${String(raw)}`)
  return parsed
}

function resolveApps(): PerfApp[] {
  const appPaths = values.app ?? []
  if (appPaths.length === 0) {
    process.stderr.write('Use --app <OpenWaggle.app | built checkout> (repeatable).\n')
    process.exit(USAGE_EXIT_CODE)
  }
  return appPaths.map((appPath, index) => resolvePerfApp(appPath, values.label?.[index]))
}

function measureVersion(app: PerfApp) {
  const startedAt = performance.now()
  const result = spawnSync(app.executable, [...app.leadingArguments, '--version'], { encoding: 'utf8' })
  return {
    app: app.label,
    versionMs: Math.round(performance.now() - startedAt),
    output: result.stdout.trim(),
  }
}

async function measureOnce(app: PerfApp, mode: string, templates: ReadonlyMap<string, string>) {
  if (mode === 'version') return measureVersion(app)
  const launchMode: LaunchMode = mode === 'warm' ? 'warm' : 'cold'
  const template = templates.get(app.label)
  return measureLaunch(app, {
    mode: launchMode,
    ...(template
      ? { templateUserData: path.join(template, 'user-data'), templateHome: path.join(template, 'home') }
      : {}),
    sessionListText: values['session-list-text'] ?? null,
    timeoutMs: numberOption(values['timeout-ms'], DEFAULT_TIMEOUT_MS),
    warmHostIdleMs: numberOption(values['warm-host-idle-ms'], DEFAULT_WARM_HOST_IDLE_MS),
    settleMs: DEFAULT_SETTLE_MS,
  })
}

async function main() {
  const apps = resolveApps()
  const mode = values.mode ?? 'cold'
  const runs = numberOption(values.runs, DEFAULT_RUNS)
  // Each build first opens its own copy of the generated profile once, as an upgrade would.
  const templates = new Map<string, string>()
  if (values.template && mode !== 'version') {
    for (const app of apps) templates.set(app.label, await warmTemplateFor(app, path.resolve(values.template)))
  }
  const results: Record<string, object[]> = Object.fromEntries(apps.map((app) => [app.label, []]))
  for (let run = 0; run < runs; run += 1) {
    // Alternate the order so neither build always runs right after the other's cleanup.
    const order = run % ORDERS === 0 ? apps : [...apps].reverse()
    for (const app of order) {
      try {
        const result = await measureOnce(app, mode, templates)
        results[app.label]?.push(result)
        log(`${app.label} ${mode} run ${String(run + 1)}: ${JSON.stringify(result).slice(0, LOGGED_RESULT_CHARS)}`)
      } catch (error) {
        results[app.label]?.push({ error: error instanceof Error ? error.message : String(error) })
        log(`${app.label} ${mode} run ${String(run + 1)} failed: ${String(error)}`)
      }
    }
  }
  const metrics = mode === 'version' ? (['versionMs'] as const) : LAUNCH_METRICS
  const summary = Object.fromEntries(
    Object.entries(results).map(([label, entries]) => [label, summarizeRuns(entries, metrics)]),
  )
  const report = { kind: `startup-${mode}`, environment: measurementEnvironment(), runs, summary, results }
  if (values.out) log(`Wrote ${await writeJsonResult(values.out, `startup-${mode}.json`, report)}`)
  process.stdout.write(`${JSON.stringify(summary, null, JSON_INDENT)}\n`)
}

main().then(
  () => exitWhenFlushed(typeof process.exitCode === 'number' ? process.exitCode : 0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    exitWhenFlushed(1)
  },
)
