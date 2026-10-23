/**
 * Production-only dead-code check for Waggle (issue #109): the two Waggle packages and the
 * desktop code that runs Waggle through them. fallow analyses the whole repository with test files
 * left out of the import graph, so code only tests use counts as unused. Findings outside the
 * Waggle scope are ignored here: the rest of the app has an existing backlog this check does not
 * gate.
 *
 * Usage: pnpm check:waggle-dead-code
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { isRecord, waggleDeadCodeFindings } from './standards/waggle-dead-code'

const execFileAsync = promisify(execFile)

const FALLOW_BINARY = path.resolve('node_modules/.bin/fallow')
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
/** fallow exits 1 when it found issues anywhere, which is normal for a repository-wide run. */
const FALLOW_ISSUES_FOUND_EXIT_CODE = 1

async function runFallow() {
  const args = ['dead-code', '--production', '--format', 'json', '--quiet']
  try {
    const { stdout } = await execFileAsync(FALLOW_BINARY, args, { maxBuffer: MAX_OUTPUT_BYTES })
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

async function main() {
  const findings = waggleDeadCodeFindings(JSON.parse(await runFallow()))
  if (findings.length === 0) {
    console.log('Waggle dead-code check passed: no production-unused Waggle code.')
    return
  }
  for (const finding of findings) {
    console.error(`${finding.path}: ${finding.kind}${finding.name ? ` (${finding.name})` : ''}`)
  }
  console.error(
    'Remove the unused Waggle code above, or use it from production code. Code only tests use counts as unused.',
  )
  process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
