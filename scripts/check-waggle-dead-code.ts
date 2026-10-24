/**
 * Production-only dead-code check for Waggle (issue #109). fallow analyses the whole repository
 * with test files left out of the import graph, so code that only tests use counts as unused. This
 * check fails on findings in the Waggle scope (`scripts/standards/waggle-dead-code.ts`); the rest of
 * the app has an existing backlog it does not gate.
 *
 * Usage: pnpm check:waggle-dead-code
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import fg from 'fast-glob'
import { isRecord } from './standards/records'
import { isWaggleScopeFile, waggleDeadCodeFindings } from './standards/waggle-dead-code'

const execFileAsync = promisify(execFile)

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
/** fallow exits 1 when it found issues anywhere, which is normal for a repository-wide run. */
const FALLOW_ISSUES_FOUND_EXIT_CODE = 1
const SCOPE_CANDIDATE_GLOBS = [
  'src/**/*.{ts,tsx}',
  'packages/{pi-waggle,waggle-core}/src/**/*.ts',
  'packages/{pi-waggle,waggle-core}/package.json',
]

/** The fallow CLI's own Node entry, run with this Node so it works where `.bin` holds shims. */
function fallowEntry() {
  return createRequire(import.meta.url).resolve('fallow/bin/fallow')
}

async function runFallow() {
  const args = [fallowEntry(), 'dead-code', '--production', '--format', 'json', '--quiet']
  try {
    const { stdout } = await execFileAsync(process.execPath, args, { maxBuffer: MAX_OUTPUT_BYTES })
    return stdout
  } catch (error) {
    if (
      isRecord(error) &&
      error.code === FALLOW_ISSUES_FOUND_EXIT_CODE &&
      typeof error.stdout === 'string'
    ) {
      return error.stdout
    }
    throw error
  }
}

async function waggleScope() {
  const candidates = await fg(SCOPE_CANDIDATE_GLOBS, { onlyFiles: true })
  const scope = new Set<string>()
  for (const file of candidates) {
    if (isWaggleScopeFile(file, await readFile(file, 'utf8'))) scope.add(file)
  }
  return scope
}

async function main() {
  const [report, scope] = await Promise.all([runFallow(), waggleScope()])
  const findings = waggleDeadCodeFindings(JSON.parse(report), scope)
  if (findings.length === 0) {
    console.log(`Waggle dead-code check passed: ${scope.size} files, no production-unused code.`)
    return
  }
  for (const finding of findings) {
    console.error(`${finding.path}: ${finding.kind}${finding.name ? ` (${finding.name})` : ''}`)
  }
  console.error(
    'Remove the unused Waggle code above, or use it from production code. Code that only tests use counts as unused.',
  )
  process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
