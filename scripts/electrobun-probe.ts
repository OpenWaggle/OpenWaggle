/**
 * Runs the packaged Electrobun probe (vendor/electrobun/probe) and records what CI needs: whether
 * the shell rendered and the CEF preview was driven over CDP, launch time, memory, install size,
 * and an OS-level screenshot of the window.
 *
 *   bun scripts/electrobun-probe.ts --build <probe build dir> --out <dir> [--artifacts <dir>] \
 *     [--label <name>] [--runs 3] [--env KEY=VALUE ...]
 *
 * The self-extracting payload (`Resources/*.tar.zst`) is unpacked into `<out>/installed`, the same
 * bytes the wrapper installs, and its inner launcher is started directly, so the timings exclude
 * the one-time extraction and every run uses the same tree. Exit status is 0 only when every run
 * reports `ok`.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { unpackElectrobunPayload } from './electrobun-payload'
import { appRss, directoryBytes, killTree, screenshot, walk } from './electrobun-probe-host'

interface RunSummary {
  readonly run: number
  readonly ok: boolean
  readonly exitCode: number | null
  readonly shellDomReadyMs: number | null
  readonly previewTargetMs: number | null
  readonly idleShellRssBytes: number | null
  readonly withPreviewRssBytes: number | null
  readonly result: unknown
}

interface RunOptions {
  readonly run: number
  readonly launcher: string
  readonly out: string
  readonly environment: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly shot: string | null
}

interface ProbeEvent {
  readonly event: string
  readonly atMs: number
}

const DEFAULT_TIMEOUT_MS = 180_000
const POLL_MS = 200
const IDLE_SAMPLE_AFTER_SHELL_MS = 5_000
const PREVIEW_DELAY_FOR_SAMPLING_MS = 8_000
const HOLD_FOR_SCREENSHOT_MS = 6_000
const SETTLE_BEFORE_SCREENSHOT_MS = 1_500
const FIRST_CLI_ARGUMENT = 2
const PAYLOAD_SEARCH_DEPTH = 5
const LAUNCHER_SEARCH_DEPTH = 6
const JSON_INDENT = 2
const APP_SUFFIX = '.app'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function installPayload(buildDirectory: string, installDirectory: string) {
  const payload = walk(buildDirectory, PAYLOAD_SEARCH_DEPTH).find((file) =>
    file.endsWith('.tar.zst'),
  )
  if (payload === undefined) throw new Error(`No self-extracting payload under ${buildDirectory}`)
  fs.rmSync(installDirectory, { recursive: true, force: true })
  await unpackElectrobunPayload(payload, installDirectory)
  return { payload, payloadBytes: fs.statSync(payload).size }
}

/** The inner launcher sits next to the bundled Bun in the installed tree. */
function findLauncher(installDirectory: string) {
  const launcherName = process.platform === 'win32' ? 'launcher.exe' : 'launcher'
  const runtimeName = process.platform === 'win32' ? 'bun.exe' : 'bun'
  const launcher = walk(installDirectory, LAUNCHER_SEARCH_DEPTH).find(
    (file) =>
      path.basename(file) === launcherName &&
      fs.existsSync(path.join(path.dirname(file), runtimeName)),
  )
  if (launcher === undefined) {
    throw new Error(`No launcher next to ${runtimeName} in ${installDirectory}`)
  }
  const appRoot = launcher.includes(APP_SUFFIX)
    ? launcher.slice(0, launcher.indexOf(APP_SUFFIX) + APP_SUFFIX.length)
    : path.dirname(path.dirname(launcher))
  return { launcher, appRoot }
}

function readEvents(file: string) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null) return []
      if (!('event' in parsed) || !('atMs' in parsed)) return []
      const { event, atMs } = parsed
      return typeof event === 'string' && typeof atMs === 'number' ? [{ event, atMs }] : []
    })
}

function eventAt(events: readonly ProbeEvent[], name: string) {
  return events.find((event) => event.event === name)?.atMs ?? null
}

function readResult(file: string) {
  const result: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  return result
}

function resultOk(result: unknown) {
  return typeof result === 'object' && result !== null && 'ok' in result && result.ok === true
}

function launch(options: RunOptions, runDirectory: string, log: number) {
  const child = spawn(options.launcher, [], {
    cwd: path.dirname(options.launcher),
    detached: process.platform !== 'win32',
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      PROBE_OUT_DIR: runDirectory,
      PROBE_HOLD_MS: String(HOLD_FOR_SCREENSHOT_MS),
      PROBE_PREVIEW_DELAY_MS: String(PREVIEW_DELAY_FOR_SAMPLING_MS),
      ELECTROBUN_CONSOLE: '1',
      ...options.environment,
    },
  })
  const state: { exited: boolean; exitCode: number | null } = { exited: false, exitCode: null }
  child.on('exit', (code) => {
    state.exitCode = code
    state.exited = true
  })
  return { pid: child.pid ?? 0, state }
}

/** Samples memory while the shell idles and once the preview is driven, then screenshots. */
async function watch(options: RunOptions, runDirectory: string, run: ReturnType<typeof launch>) {
  const started = Date.now()
  const eventsFile = path.join(runDirectory, 'probe.jsonl')
  const resultFile = path.join(runDirectory, 'result.json')
  const samples: { idle: number | null; withPreview: number | null } = {
    idle: null,
    withPreview: null,
  }
  while (!run.state.exited && Date.now() - started < options.timeoutMs) {
    const shellReady = eventAt(readEvents(eventsFile), 'shell-dom-ready')
    const idleDue =
      shellReady !== null && Date.now() - started > shellReady + IDLE_SAMPLE_AFTER_SHELL_MS
    if (idleDue && samples.idle === null) samples.idle = appRss(run.pid)
    if (samples.withPreview === null && fs.existsSync(resultFile)) {
      samples.withPreview = appRss(run.pid)
      await delay(SETTLE_BEFORE_SCREENSHOT_MS)
      if (options.shot !== null) screenshot(options.shot)
    }
    await delay(POLL_MS)
  }
  if (!run.state.exited) killTree(run.pid)
  return samples
}

async function runOnce(options: RunOptions) {
  const runDirectory = path.join(options.out, `run-${options.run}`)
  fs.rmSync(runDirectory, { recursive: true, force: true })
  fs.mkdirSync(runDirectory, { recursive: true })
  const log = fs.openSync(path.join(runDirectory, 'launcher.log'), 'w')
  const run = launch(options, runDirectory, log)
  const samples = await watch(options, runDirectory, run)
  fs.closeSync(log)
  const events = readEvents(path.join(runDirectory, 'probe.jsonl'))
  const result = readResult(path.join(runDirectory, 'result.json'))
  return {
    run: options.run,
    ok: resultOk(result) && run.state.exitCode === 0,
    exitCode: run.state.exitCode,
    shellDomReadyMs: eventAt(events, 'shell-dom-ready'),
    previewTargetMs: eventAt(events, 'cdp-preview-target'),
    idleShellRssBytes: samples.idle,
    withPreviewRssBytes: samples.withPreview,
    result,
  }
}

function parseEnvironment(entries: readonly string[]) {
  return Object.fromEntries(
    entries.map((entry) => {
      const separator = entry.indexOf('=')
      if (separator <= 0) throw new Error(`--env expects KEY=VALUE, got ${entry}`)
      return [entry.slice(0, separator), entry.slice(separator + 1)]
    }),
  )
}

function artifactSizes(directory: string | undefined) {
  if (directory === undefined) return []
  return walk(path.resolve(directory), 0).map((file) => ({
    file: path.basename(file),
    bytes: fs.statSync(file).size,
  }))
}

function parseCli() {
  const { values } = parseArgs({
    args: process.argv.slice(FIRST_CLI_ARGUMENT),
    options: {
      build: { type: 'string' },
      artifacts: { type: 'string' },
      out: { type: 'string' },
      label: { type: 'string', default: 'probe' },
      runs: { type: 'string', default: '1' },
      'timeout-ms': { type: 'string', default: String(DEFAULT_TIMEOUT_MS) },
      env: { type: 'string', multiple: true, default: [] },
    },
  })
  const { build, out } = values
  if (build === undefined || out === undefined) {
    throw new Error(
      'Usage: electrobun-probe.ts --build <dir> --out <dir> [--artifacts <dir>] [--label <name>]',
    )
  }
  return { ...values, build, out: path.resolve(out) }
}

async function main() {
  const cli = parseCli()
  fs.mkdirSync(cli.out, { recursive: true })
  const installDirectory = path.join(cli.out, 'installed')
  const { payload, payloadBytes } = await installPayload(path.resolve(cli.build), installDirectory)
  const { launcher, appRoot } = findLauncher(installDirectory)
  const runs: RunSummary[] = []
  for (let run = 1; run <= Number(cli.runs); run += 1) {
    const summary = await runOnce({
      run,
      launcher,
      out: cli.out,
      environment: parseEnvironment(cli.env),
      timeoutMs: Number(cli['timeout-ms']),
      shot: run === 1 ? path.join(cli.out, `${cli.label}-window.png`) : null,
    })
    console.log(`${cli.label} run ${run}: ${JSON.stringify({ ...summary, result: undefined })}`)
    runs.push(summary)
  }
  const report = {
    label: cli.label,
    platform: process.platform,
    arch: process.arch,
    ok: runs.every((run) => run.ok),
    payload: path.basename(payload),
    payloadBytes,
    installedBytes: directoryBytes(appRoot),
    artifacts: artifactSizes(cli.artifacts),
    runs,
  }
  fs.writeFileSync(
    path.join(cli.out, 'summary.json'),
    `${JSON.stringify(report, null, JSON_INDENT)}\n`,
  )
  const brief = { ...report, runs: runs.map((run) => ({ ...run, result: undefined })) }
  console.log(JSON.stringify(brief, null, JSON_INDENT))
  if (!report.ok) process.exitCode = 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
}
