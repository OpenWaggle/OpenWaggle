/**
 * The Electron side of the shell bench: download and installed size, cold and warm launch, idle
 * and after-turn memory of the packaged app, measured the way the Electrobun package proof
 * measures its build (scripts/electrobun/ci/smoke.ts on the Electrobun branch), so the two tables
 * compare. `.github/workflows/bench-electron.yml` runs it on macOS arm64, Ubuntu x64 and Windows
 * x64 GitHub runners.
 *
 *   bun scripts/bench/electron-bench.ts install --dist dist --dir <install dir> --out <json>
 *     Installs the fresh-install artifact (macOS DMG, Windows NSIS installer, Linux AppImage) and
 *     records the download and installed sizes.
 *   bun scripts/bench/electron-bench.ts measure --install <json> --runs 4 --work <dir> --out <json>
 *     Each run takes a new scratch profile (userData, HOME, compile cache) and makes:
 *     - a cold launch: spawn until the DevTools endpoint lists the renderer page (window ready) and
 *       until the window reports startup status `ready` (backend ready); 10 s idle, then the
 *       resident memory of every app process (the window, its Chromium helpers and the Session
 *       Host, by role); one turn against a local fake provider through `openwaggle run`, shown in
 *       the window; 10 s idle and memory again (after turn). The first run also proves a terminal
 *       and a Browser preview.
 *     - a warm launch of the same profile; a second launch then hands it that Session's
 *       `openwaggle://` link through the single-instance lock, and the window opens it.
 *   bun scripts/bench/electron-bench.ts summarize <json>... [--label <label>]...
 *     Medians of each result as a Markdown table, with the per-process breakdown.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  type BenchResult,
  type BenchRun,
  isBenchResult,
  roleTable,
  summarizeBench,
  TABLE_HEADER,
  tableRow,
} from './bench-stats'
import { measureRun } from './electron-bench-run'
import { installElectronApp, isInstalledElectronApp } from './electron-installed-app'

const DEFAULT_RUNS = 4
const JSON_INDENT = 2
const FIRST_ARGUMENT = 2
const SUBCOMMAND_OPTIONS = 1

function readJson<T>(file: string, guard: (value: unknown) => value is T, what: string) {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!guard(parsed)) throw new Error(`${file} is not ${what}.`)
  return parsed
}

function step(message: string) {
  console.log(`bench: ${message}`)
}

async function measure(options: {
  readonly install: string
  readonly runs: number
  readonly work: string
  readonly out: string
  readonly label: string
  readonly screenshots: string | undefined
  readonly logs: string | undefined
}) {
  const installed = readJson(options.install, isInstalledElectronApp, 'an installed app')
  const runs: BenchRun[] = []
  let proof: unknown = null
  for (let index = 1; index <= options.runs; index += 1) {
    const measured = await measureRun({
      app: installed,
      root: options.work,
      index,
      prove: index === 1,
      screenshots: options.screenshots,
      logs: options.logs,
    })
    runs.push(measured.run)
    step(`run ${String(index)} of ${String(options.runs)} measured`)
    if (index === 1) proof = measured.proof
  }
  const result: BenchResult = {
    label: options.label,
    platform: process.platform,
    arch: process.arch,
    downloads: installed.downloads,
    installedBytes: installed.installedBytes,
    runs,
    proof,
  }
  fs.writeFileSync(options.out, `${JSON.stringify(result, null, JSON_INDENT)}\n`)
  console.log(JSON.stringify(summarizeBench(result), null, JSON_INDENT))
}

function summarize(files: readonly string[]) {
  const summaries = files.map((file) => {
    return summarizeBench(readJson(file, isBenchResult, 'a bench result'))
  })
  const lines = [...TABLE_HEADER, ...summaries.map(tableRow)]
  for (const summary of summaries) {
    lines.push(
      '',
      `${summary.label} (${summary.platform}), per process:`,
      '',
      ...roleTable(summary),
    )
  }
  console.log(lines.join('\n'))
}

async function main(argv: readonly string[]) {
  const [command] = argv
  const { values, positionals } = parseArgs({
    args: argv.slice(SUBCOMMAND_OPTIONS),
    allowPositionals: true,
    options: {
      dist: { type: 'string', default: 'dist' },
      dir: { type: 'string' },
      out: { type: 'string' },
      install: { type: 'string' },
      runs: { type: 'string', default: String(DEFAULT_RUNS) },
      work: { type: 'string' },
      label: { type: 'string', default: 'electron' },
      screenshots: { type: 'string' },
      logs: { type: 'string' },
    },
  })
  if (command === 'install' && values.dir !== undefined && values.out !== undefined) {
    const installed = installElectronApp(path.resolve(values.dist), path.resolve(values.dir))
    fs.writeFileSync(values.out, `${JSON.stringify(installed, null, JSON_INDENT)}\n`)
    console.log(JSON.stringify(installed))
    return
  }
  if (command === 'measure' && values.install && values.work && values.out) {
    await measure({
      install: values.install,
      runs: Number(values.runs),
      work: path.resolve(values.work),
      out: values.out,
      label: values.label,
      screenshots: values.screenshots,
      logs: values.logs,
    })
    return
  }
  if (command === 'summarize' && positionals.length > 0) {
    summarize(positionals)
    return
  }
  throw new Error('Usage: see the header of scripts/bench/electron-bench.ts.')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(FIRST_ARGUMENT)).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : error)
      process.exit(1)
    },
  )
}
