/**
 * Typechecks the renderer test files and ratchets the result against a baseline.
 *
 * Why this exists: renderer tests were compiled with `noCheck`, so a mock whose shape
 * did not match the interface it stood in for compiled silently. One did, and the test
 * passed while asserting against a shape the real component never receives — the wrong
 * mock was invisible precisely because the tests were the one place types were not
 * enforced.
 *
 * Turning checking on surfaced a large pre-existing backlog, so this is not a demand for
 * zero everywhere. It is binary per file: any file NOT on the exemption list must have
 * zero errors, and an exempt file that has become clean fails as a stale exemption so
 * the list can only shrink.
 *
 * Binary rather than a count, because a count-based ratchet is defeated by swapping one
 * error for another: verified while building this, a deliberately wrong mock in a file
 * that already had errors left the total unchanged and passed.
 *
 * Run `pnpm typecheck:tests --update` after genuinely fixing files.
 */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PROJECT = 'tsconfig.renderer-tests.json'
const EXEMPTIONS_FILE = 'scripts/renderer-test-type-exemptions.json'
const JSON_INDENT = 2

const TSC_OUTPUT_MAX_BUFFER_BYTES = 32 * 1024 * 1024

const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),\d+\): error TS\d+:/u



interface TypecheckRun {
  readonly output: string
  readonly failed: boolean
}

async function runTypecheck(): Promise<TypecheckRun> {
  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['tsc', '-b', PROJECT, '--force', '--pretty', 'false'],
      { cwd: process.cwd(), maxBuffer: TSC_OUTPUT_MAX_BUFFER_BYTES },
    )
    return { output: stdout, failed: false }
  } catch (error) {
    /*
     * tsc exits non-zero when it reports errors; its findings are on stdout. The exit status is
     * kept, not discarded: several tsc failures carry no `file(line,col):` prefix - TS18003 "No
     * inputs were found in config file" is the dangerous one, verified to exit 2 with an
     * unparseable message - so a verdict computed from parsed lines alone reported success for a
     * run that checked nothing. That is exactly the `noCheck` state this guard exists to prevent.
     */
    if (error !== null && typeof error === 'object' && 'stdout' in error) {
      const { stdout } = error
      if (typeof stdout === 'string') return { output: stdout, failed: true }
    }
    throw error
  }
}

/**
 * How many test files tsc actually pulled into the program.
 *
 * The second half of the tripwire, and it has to measure what tsc *checked* rather than what
 * exists on disk: an `include` that stops matching test files leaves the repository untouched, so
 * counting files in git would keep reporting a healthy number while the guard covered nothing.
 * Emptying the exemption list removed the stale-exemption check that used to notice such a run.
 */
async function countCheckedTestFiles(): Promise<number> {
  const { stdout } = await execFileAsync(
    'npx',
    ['tsc', '-b', PROJECT, '--force', '--pretty', 'false', '--listFiles'],
    { cwd: process.cwd(), maxBuffer: TSC_OUTPUT_MAX_BUFFER_BYTES },
  ).catch((error: unknown) => {
    // A failing typecheck still lists its program; the caller reports the errors.
    if (error !== null && typeof error === 'object' && 'stdout' in error) {
      const { stdout: failedOutput } = error
      if (typeof failedOutput === 'string') return { stdout: failedOutput }
    }
    return { stdout: '' }
  })
  return stdout.split('\n').filter((line) => isRendererTestFile(line.trim())).length
}

/**
 * A renderer test file, specifically.
 *
 * Scoped to `src/renderer/`: this project references the Node one, whose own test files also appear
 * in `--listFiles`, so an unscoped count stayed in the hundreds even with every renderer test
 * excluded - measuring the wrong project's health.
 */
function isRendererTestFile(filePath: string) {
  return filePath.includes('/src/renderer/') && /\.test\.tsx?$/u.test(filePath)
}

/**
 * Below this, the project is not really checking the renderer tests any more.
 *
 * Well under the real count (234 renderer test files at the time of writing) so ordinary churn
 * never trips it, but far above zero so a project that stopped matching them cannot pass.
 */
const MINIMUM_RENDERER_TEST_FILES = 100

function countErrorsByFile(output: string): ErrorCounts {
  const counts: Record<string, number> = {}
  for (const rawLine of output.split('\n')) {
    const match = ERROR_LINE.exec(rawLine.trim())
    const file = match?.groups?.['file']
    if (file === undefined) continue
    const normalized = file.split(path.sep).join('/')
    counts[normalized] = (counts[normalized] ?? 0) + 1
  }
  return counts
}

type ErrorCounts = Readonly<Record<string, number>>

function total(counts: ErrorCounts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

async function readExemptions() {
  try {
    const parsed: unknown = JSON.parse(await readFile(EXEMPTIONS_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

async function main() {
  const { output, failed } = await runTypecheck()
  const current = countErrorsByFile(output)
  const failingFiles = Object.keys(current).sort()

  if (failed && failingFiles.length === 0) {
    console.error(
      'tsc failed but reported no file-scoped type errors, so this run checked nothing.\n' +
        'Raw output:\n',
    )
    console.error(output.trim() || '(no output)')
    process.exitCode = 1
    return
  }

  const testFileCount = await countCheckedTestFiles()
  if (testFileCount < MINIMUM_RENDERER_TEST_FILES) {
    console.error(
      `tsc pulled in only ${String(testFileCount)} test file(s), below the floor of ` +
        `${String(MINIMUM_RENDERER_TEST_FILES)}. The project's include has stopped matching the ` +
        'renderer tests, so this guard is checking almost nothing.',
    )
    process.exitCode = 1
    return
  }

  if (process.argv.includes('--update')) {
    await writeFile(EXEMPTIONS_FILE, `${JSON.stringify(failingFiles, null, JSON_INDENT)}\n`, 'utf8')
    console.log(`Updated exemptions: ${failingFiles.length} file(s), ${total(current)} error(s)`)
    return
  }

  const exemptions = await readExemptions()
  const unexpected = failingFiles.filter((file) => !exemptions.includes(file))
  const staleExemptions = exemptions.filter((file) => !failingFiles.includes(file))

  if (unexpected.length > 0) {
    console.error('Type errors in renderer test files that are required to be clean:\n')
    for (const file of unexpected) console.error(`  ${file} (${current[file]} error(s))`)
    console.error(
      '\nFix the fixture so it matches the interface. Usually a required field is' +
        ' missing or has the wrong type.\n' +
        'Do NOT reach for fromPartial to silence this: it casts, so it hides a genuine' +
        ' mismatch just as effectively as it expresses an intentional partial mock.',
    )
    process.exitCode = 1
    return
  }

  if (staleExemptions.length > 0) {
    console.error('These files are now clean and must be removed from the exemption list:\n')
    for (const file of staleExemptions) console.error(`  ${file}`)
    console.error('\nRun: pnpm typecheck:tests --update')
    process.exitCode = 1
    return
  }

  console.log(
    `Renderer test types: ${failingFiles.length} exempt file(s) with ${total(current)} known error(s); all other test files are clean.`,
  )
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
