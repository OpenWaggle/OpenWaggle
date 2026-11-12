/**
 * The Performance Gate's A/B timing run: two built checkouts of OpenWaggle (the pull request's
 * merge base and its head) measured on one machine, interleaved A/B/A/B, each sample on a new
 * scratch profile (ab-sample.ts). One discarded warm-up sample of each build first loads the
 * binaries and `out/` into the file cache, so the first measured sample is not an outlier.
 *
 *   bun scripts/perf-gate/ab-run.ts --base <checkout> --head <checkout> --pairs 6 \
 *     --work <dir> --out <results.json> [--idle-ms 5000] [--base-label main] [--head-label pr]
 *
 * Each checkout must be built (`bun run build`, or `electron-vite build` after the native rebuild);
 * the app runs unpackaged from its directory with that checkout's Electron. ab-verdict.ts compares
 * the results.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type { InstalledElectronApp } from '../bench/electron-installed-app'
import { type AbSample, measureSample } from './ab-sample'

const DEFAULT_PAIRS = 6
const DEFAULT_IDLE_MS = 5_000
const JSON_INDENT = 2
const FIRST_ARGUMENT = 2
const WARM_UP_ORDER = 0
const MEBIBYTE = 1_048_576

export interface AbResults {
  readonly platform: string
  readonly arch: string
  readonly pairs: number
  readonly idleMs: number
  readonly builds: Readonly<Record<'base' | 'head', { readonly label: string }>>
  readonly samples: readonly AbSample[]
}

/** A built checkout as the bench harness launches it: its own Electron, given the directory. */
export function unpackagedApp(checkout: string): InstalledElectronApp {
  const root = fs.realpathSync(checkout)
  const electron: unknown = createRequire(path.join(root, 'package.json'))('electron')
  if (typeof electron !== 'string') throw new Error(`${root} has no Electron binary.`)
  if (!fs.existsSync(path.join(root, 'out', 'main', 'boot.js'))) {
    throw new Error(`${root} is not built: out/main/boot.js is missing.`)
  }
  return {
    launcher: electron,
    leadingArguments: [root],
    installRoot: root,
    installedBytes: 0,
    downloads: {},
  }
}

function log(message: string) {
  console.log(`perf-gate: ${message}`)
}

function describe(sample: AbSample) {
  const { cold, warm } = sample
  return `${sample.build} #${String(sample.order)}: cold window ${String(cold.windowReadyMs)} backend ${String(cold.backendReadyMs)} chat ${String(cold.chatReadyMs)} ms (ipc ${String(cold.ipcCallsUntilChatReady)}), warm chat ${String(warm.chatReadyMs)} ms, idle ${String(Math.round(sample.idle.rssBytes / MEBIBYTE))} MiB, after turn ${String(Math.round(sample.afterTurn.rssBytes / MEBIBYTE))} MiB`
}

export async function runAb(options: {
  readonly base: string
  readonly head: string
  readonly pairs: number
  readonly idleMs: number
  readonly work: string
  readonly labels: { readonly base: string; readonly head: string }
}): Promise<AbResults> {
  const apps = { base: unpackagedApp(options.base), head: unpackagedApp(options.head) }
  const builds = ['base', 'head'] as const
  const samples: AbSample[] = []
  for (const build of builds) {
    const warmUp = await measureSample({
      app: apps[build],
      build,
      order: WARM_UP_ORDER,
      root: options.work,
      idleMs: 0,
    })
    log(`warm-up ${describe(warmUp)}`)
  }
  for (let pair = 1; pair <= options.pairs; pair += 1) {
    for (const build of builds) {
      const sample = await measureSample({
        app: apps[build],
        build,
        order: pair,
        root: options.work,
        idleMs: options.idleMs,
      })
      samples.push(sample)
      log(describe(sample))
    }
  }
  return {
    platform: process.platform,
    arch: process.arch,
    pairs: options.pairs,
    idleMs: options.idleMs,
    builds: { base: { label: options.labels.base }, head: { label: options.labels.head } },
    samples,
  }
}

async function main(argv: readonly string[]) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      pairs: { type: 'string', default: String(DEFAULT_PAIRS) },
      'idle-ms': { type: 'string', default: String(DEFAULT_IDLE_MS) },
      work: { type: 'string' },
      out: { type: 'string' },
      'base-label': { type: 'string', default: 'base' },
      'head-label': { type: 'string', default: 'head' },
    },
  })
  if (!values.base || !values.head || !values.work || !values.out) {
    throw new Error('Usage: see the header of scripts/perf-gate/ab-run.ts.')
  }
  const results = await runAb({
    base: values.base,
    head: values.head,
    pairs: Number(values.pairs),
    idleMs: Number(values['idle-ms']),
    work: path.resolve(values.work),
    labels: { base: values['base-label'], head: values['head-label'] },
  })
  fs.writeFileSync(values.out, `${JSON.stringify(results, null, JSON_INDENT)}\n`)
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
