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



async function runTypecheck(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['tsc', '-b', PROJECT, '--force', '--pretty', 'false'],
      { cwd: process.cwd(), maxBuffer: TSC_OUTPUT_MAX_BUFFER_BYTES },
    )
    return stdout
  } catch (error) {
    // tsc exits non-zero when it reports errors; its findings are on stdout.
    if (error !== null && typeof error === 'object' && 'stdout' in error) {
      const { stdout } = error
      if (typeof stdout === 'string') return stdout
    }
    throw error
  }
}

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
  const output = await runTypecheck()
  const current = countErrorsByFile(output)
  const failingFiles = Object.keys(current).sort()

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
