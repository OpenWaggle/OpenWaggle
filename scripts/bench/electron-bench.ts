/**
 * The shell bench: download and installed size, cold and warm window-ready time, idle and
 * after-turn memory of a packaged OpenWaggle app, measured the same way for the Electron and the
 * Electrobun shell so their results share one table. Every count comes from the same code: the
 * process accounting (app-processes.ts, the launched process and its descendants plus a Session Host
 * that was reparented), the startup marks (startup-marks.ts) and the medians (bench-stats.ts).
 * `.github/workflows/bench-shells.yml` runs it on macOS arm64, Ubuntu x64 and Windows x64 runners.
 *
 *   bun scripts/bench/electron-bench.ts install --shell <electron|electrobun> --dist <dir>
 *       --dir <install dir> --out <json>
 *     Installs the fresh-install artifact (DMG; Windows installer; AppImage) from `--dist`
 *     (electron-builder's `dist`, or the Electrobun release directory) and records the download
 *     and installed sizes. Electrobun installs where its installer puts it and ignores `--dir`;
 *     `--launcher <installed launcher>` takes the app the package proof already installed.
 *   bun scripts/bench/electron-bench.ts measure --shell <shell> --install <json> --runs 4
 *       --work <dir> --out <json>
 *     Each run takes a new scratch profile and makes a cold launch (window shown, backend ready,
 *     10 s idle, memory; one turn against a local fake provider through `openwaggle run`, shown in
 *     the window; 10 s idle, memory) and a warm launch of the same profile that opens that
 *     Session's `openwaggle://` link. The first run also proves a terminal and a Browser preview.
 *   bun scripts/bench/electron-bench.ts summarize <json>...
 *     Medians of each result as one Markdown table, with the per-process breakdown. The window
 *     column is the `window-ready-to-show` mark on either shell.
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
import { installElectrobunApp, measureElectrobunRun } from './electrobun-bench-run'
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

type Shell = 'electron' | 'electrobun'

function shellOf(value: string) {
  if (value !== 'electron' && value !== 'electrobun') {
    throw new Error(`--shell is electron or electrobun, not ${value}.`)
  }
  const shell: Shell = value
  return shell
}

async function measure(options: {
  readonly shell: Shell
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
    const run = {
      root: options.work,
      index,
      prove: index === 1,
      screenshots: options.screenshots,
      logs: options.logs,
    }
    const measured =
      options.shell === 'electron'
        ? await measureRun({ ...run, app: installed })
        : await measureElectrobunRun({ ...run, launcher: installed.launcher })
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
      launcher: { type: 'string' },
      out: { type: 'string' },
      install: { type: 'string' },
      runs: { type: 'string', default: String(DEFAULT_RUNS) },
      work: { type: 'string' },
      shell: { type: 'string', default: 'electron' },
      label: { type: 'string' },
      screenshots: { type: 'string' },
      logs: { type: 'string' },
    },
  })
  const shell = shellOf(values.shell)
  const electronInstall = shell === 'electron' ? values.dir : 'unused'
  if (command === 'install' && electronInstall !== undefined && values.out !== undefined) {
    const installed =
      shell === 'electron'
        ? installElectronApp(path.resolve(values.dist), path.resolve(electronInstall))
        : await installElectrobunApp(
            path.resolve(values.dist),
            values.launcher === undefined ? undefined : path.resolve(values.launcher),
          )
    fs.writeFileSync(values.out, `${JSON.stringify(installed, null, JSON_INDENT)}\n`)
    console.log(JSON.stringify(installed))
    return
  }
  if (command === 'measure' && values.install && values.work && values.out) {
    await measure({
      shell,
      install: values.install,
      runs: Number(values.runs),
      work: path.resolve(values.work),
      out: values.out,
      label: values.label ?? shell,
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
