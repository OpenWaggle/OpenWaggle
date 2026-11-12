/**
 * Coverage uniqueness (.agents/standards.md, Testing): which statements and branch arms each
 * test file covers that no other test file does.
 *
 *   bun scripts/coverage-uniqueness.ts index --out <file> [--shard <i>/<n>] [--concurrency <n>]
 *   bun scripts/coverage-uniqueness.ts merge --out <file> <shard.json>...
 *   bun scripts/coverage-uniqueness.ts advise [--index <file>] [--base <ref>]
 *
 * - `index` runs every tier test file (or one shard of them) alone under v8 coverage and writes
 *   the index; the nightly workflow runs it in shards and `merge` joins them.
 * - `advise` is the check runner's advisory step: it measures only the test files this branch
 *   adds and prints one finding for each that covers nothing the index has no other file
 *   covering. Zero unique coverage is a candidate, not a verdict (contract and refusal tests show
 *   none), so it never fails. Without new test files it returns at once; without an index it
 *   downloads the nightly one with `gh` (or reads `--index`, or COVERAGE_UNIQUENESS_INDEX), and
 *   says so when it cannot.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { listAddedFiles, listRepositoryFiles } from './check/repository-files'
import { measureFiles, tierConfig } from './coverage-uniqueness/measure'
import {
  type CoverageIndex,
  CoverageIndexBuilder,
  isCoverageIndex,
  uniqueUnits,
} from './coverage-uniqueness/units'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const DEFAULT_INDEX = '.tmp/coverage-uniqueness/index.json'
const INDEX_ARTIFACT = 'coverage-uniqueness-index'
const DEFAULT_INDEX_CONCURRENCY = 4
const ADVISE_CONCURRENCY = 2
/** A branch that adds more is a large one; the rest are named but not measured. */
const MAX_ADVISED_FILES = 6
const PROGRESS_EVERY = 50
const SHORT_COMMIT = 9
/** `YYYY-MM-DD` of an ISO timestamp. */
const DATE_LENGTH = 10
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024
const SCRIPT_ARGUMENTS_START = 2

function option(args: readonly string[], name: string) {
  const position = args.indexOf(name)
  return position >= 0 ? args[position + 1] : undefined
}

function positional(args: readonly string[]) {
  return args.filter(
    (arg, position) => !arg.startsWith('--') && !args[position - 1]?.startsWith('--'),
  )
}

async function git(args: readonly string[]) {
  return (await execFileAsync('git', [...args], { cwd: ROOT })).stdout.trim()
}

/** Tier test files, sorted; with `shard` as `i/n`, every n-th of them starting at the i-th. */
export function selectShard(files: readonly string[], shard: string | undefined) {
  const tests = files.filter((file) => tierConfig(file) !== undefined)
  if (shard === undefined) return tests
  const [index, count] = shard.split('/').map(Number)
  if (!Number.isInteger(index) || !Number.isInteger(count) || !index || !count || index > count) {
    throw new Error(`--shard takes <i>/<n> with 1 <= i <= n, not ${shard}`)
  }
  return tests.filter((_, position) => position % count === index - 1)
}

async function writeIndex(out: string, index: CoverageIndex) {
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(index))
}

async function buildIndex(args: readonly string[]) {
  const out = option(args, '--out') ?? DEFAULT_INDEX
  const concurrency = Number(option(args, '--concurrency') ?? DEFAULT_INDEX_CONCURRENCY)
  const files = selectShard(await listRepositoryFiles(ROOT), option(args, '--shard'))
  const builder = new CoverageIndexBuilder()
  const started = performance.now()
  await measureFiles(ROOT, files, concurrency, (measurement, finished) => {
    builder.add(measurement.file, measurement.units)
    if (measurement.units === undefined) console.log(`failed: ${measurement.file}`)
    if (finished % PROGRESS_EVERY === 0) console.log(`${finished} / ${files.length}`)
  })
  const index = builder.build(await git(['rev-parse', 'HEAD']), performance.now() - started)
  await writeIndex(out, index)
  const units = Object.keys(index.units).length
  console.log(`${files.length} files, ${index.failed.length} failed, ${units} units -> ${out}`)
}

async function readIndex(file: string) {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isCoverageIndex(value)) throw new Error(`${file} is not a coverage-uniqueness index`)
  return value
}

async function mergeIndexes(args: readonly string[]) {
  const out = option(args, '--out') ?? DEFAULT_INDEX
  const builder = new CoverageIndexBuilder()
  let commit = ''
  let durationMs = 0
  for (const file of positional(args.slice(1))) {
    const shard = await readIndex(file)
    builder.merge(shard)
    commit ||= shard.commit
    durationMs += shard.durationMs
  }
  await writeIndex(out, builder.build(commit, durationMs))
  console.log(`merged -> ${out}`)
}

/** The latest nightly index, downloaded with `gh` into the default location. */
async function downloadIndex() {
  const { stdout } = await execFileAsync(
    'gh',
    [
      'api',
      `repos/{owner}/{repo}/actions/artifacts?name=${INDEX_ARTIFACT}&per_page=1`,
      '--jq',
      '.artifacts[0].workflow_run.id',
    ],
    { cwd: ROOT },
  )
  const run = stdout.trim()
  if (!/^\d+$/u.test(run)) throw new Error('no nightly coverage-uniqueness index yet')
  const directory = path.dirname(DEFAULT_INDEX)
  await mkdir(directory, { recursive: true })
  await execFileAsync('gh', ['run', 'download', run, '-n', INDEX_ARTIFACT, '-D', directory], {
    cwd: ROOT,
    maxBuffer: MAX_ARTIFACT_BYTES,
  })
  return readIndex(DEFAULT_INDEX)
}

async function loadIndex(args: readonly string[]) {
  const file = option(args, '--index') ?? process.env['COVERAGE_UNIQUENESS_INDEX']
  if (file !== undefined) return readIndex(file)
  return readIndex(DEFAULT_INDEX).catch(downloadIndex)
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function advise(args: readonly string[]) {
  const added = await listAddedFiles(option(args, '--base') ?? 'origin/main', ROOT)
  const tests = added.filter((file) => tierConfig(file) !== undefined)
  if (tests.length === 0) return
  const files = tests.slice(0, MAX_ADVISED_FILES)
  if (tests.length > files.length) {
    console.log(
      `${tests.length - files.length} more new test files not checked, from ${tests[files.length]}`,
    )
  }
  const index = await loadIndex(args).catch((error: unknown) => {
    // CI's Typecheck & Lint job has no token to read the index; the Test advisory workflow does.
    const tokenless = process.env['GITHUB_ACTIONS'] === 'true' && !process.env['GH_TOKEN']
    if (!tokenless) console.log(`${tests.length} new test files not checked: ${errorText(error)}`)
  })
  if (index === undefined) return
  // Only now, with files to run: the tiers load native modules built for Node (cached).
  await execFileAsync(process.execPath, ['scripts/rebuild-native-deps.ts', 'node'], { cwd: ROOT })
  const source = `the ${index.generatedAt.slice(0, DATE_LENGTH)} index at ${index.commit.slice(0, SHORT_COMMIT)}`
  await measureFiles(ROOT, files, ADVISE_CONCURRENCY, ({ file, units, error }) => {
    if (units === undefined) {
      console.log(
        `${file}:1:1 coverage-uniqueness advisory: not measured (${error?.split('\n').at(-1) ?? ''})`,
      )
      return
    }
    if (uniqueUnits(index, file, units).length === 0) {
      console.log(
        `${file}:1:1 coverage-uniqueness advisory: another test already covers every statement and branch arm it covers (${source}); keep it only if it asserts an outcome no other test does, else move its cases into that test`,
      )
    }
  })
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => Promise<void>>> = {
  index: buildIndex,
  merge: mergeIndexes,
  advise,
}

if (import.meta.main) {
  const args = process.argv.slice(SCRIPT_ARGUMENTS_START)
  const command = COMMANDS[args[0] ?? '']
  if (command === undefined) {
    console.error('usage: coverage-uniqueness.ts index|merge|advise (see the header comment)')
    process.exitCode = 1
  } else {
    command(args).catch((error: unknown) => {
      console.log(`coverage-uniqueness ${args[0] ?? ''}: ${errorText(error)}`)
      // Advice never fails the gate; building the index does.
      process.exitCode = args[0] === 'advise' ? 0 : 1
    })
  }
}
