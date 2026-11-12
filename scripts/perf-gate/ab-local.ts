/**
 * Reproduces the Performance Gate's timing job on this machine in one command:
 *
 *   bun run perf:ab [--base <ref>] [--pairs <n>] [--idle-ms <ms>]
 *
 * It checks the base (the merge base with origin/main unless `--base` names another ref) out
 * into a detached worktree under `.tmp/perf-gate/base`, installs and builds it, builds this
 * checkout, measures both interleaved (ab-run.ts) and prints the gate's verdict and table. Linux
 * needs a display (`xvfb-run bun run perf:ab`). Local numbers are only comparable with each other:
 * the thresholds were set on GitHub's runners.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { runAb } from './ab-run'
import { timingVerdict } from './ab-verdict'
import { abFailureLines, parseThresholds } from './gate-files'
import { parsePerfGateReport } from './report-data'
import { renderReport } from './report-markdown'

const WORK = path.resolve('.tmp/perf-gate')
const BASE_CHECKOUT = path.join(WORK, 'base')
const THRESHOLDS = 'performance/perf-gate/thresholds.json'
const INHERIT = { stdio: 'inherit' } as const

function git(args: readonly string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function checkOutBase(sha: string) {
  if (fs.existsSync(BASE_CHECKOUT)) {
    if (git(['-C', BASE_CHECKOUT, 'rev-parse', 'HEAD']) === sha) return
    // The perf:ab worktree is this command's own scratch checkout.
    execFileSync('git', ['worktree', 'remove', '--force', BASE_CHECKOUT], INHERIT)
  }
  execFileSync('git', ['worktree', 'add', '--detach', BASE_CHECKOUT, sha], INHERIT)
}

function build(directory: string) {
  execFileSync('bun', ['install', '--frozen-lockfile'], { ...INHERIT, cwd: directory })
  execFileSync('bun', ['run', 'build'], { ...INHERIT, cwd: directory })
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      pairs: { type: 'string' },
      'idle-ms': { type: 'string' },
    },
  })
  const thresholds = parseThresholds(JSON.parse(fs.readFileSync(THRESHOLDS, 'utf8')))
  const baseSha = git(['rev-parse', values.base ?? git(['merge-base', 'origin/main', 'HEAD'])])
  const headSha = git(['rev-parse', 'HEAD'])
  checkOutBase(baseSha)
  build(BASE_CHECKOUT)
  build(process.cwd())
  const results = await runAb({
    base: BASE_CHECKOUT,
    head: process.cwd(),
    pairs: Number(values.pairs ?? thresholds.pairs),
    idleMs: Number(values['idle-ms'] ?? thresholds.idleMs),
    work: path.join(WORK, 'profiles'),
    labels: { base: baseSha, head: headSha },
  })
  fs.writeFileSync(path.join(WORK, 'ab.json'), `${JSON.stringify(results)}\n`)
  const verdict = timingVerdict({ results, thresholds, headThresholds: thresholds, labels: [] })
  const report = parsePerfGateReport({
    baseSha,
    headSha,
    budgets: null,
    timings: verdict,
    pairs: results.pairs,
    platform: `${results.platform}-${results.arch}`,
    labels: [],
  })
  if (report) console.log(renderReport(report))
  for (const line of abFailureLines(verdict, results)) console.error(line)
  return verdict.passed ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error)
    process.exit(1)
  },
)
