import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { validateConventionalCommits } from './check-conventional-commits'

const execFileAsync = promisify(execFile)

const GIT_MERGE_BASE_MAX_BUFFER_BYTES = 10_000_000
const SHORT_SHA_LENGTH = 12

/**
 * Resolves the baseline for local commit-policy validation. The merge base with
 * `origin/main` keeps the check scoped to this branch's commits even when local refs are
 * stale. Falls back to the ref itself when the merge base cannot be resolved (for
 * example on a detached checkout without a fetched `origin/main`), which still validates
 * a useful range.
 */
async function resolveLocalBaseline() {
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', 'origin/main'], {
      maxBuffer: GIT_MERGE_BASE_MAX_BUFFER_BYTES,
    })
    return stdout.trim()
  } catch (error) {
    console.error(
      'Could not resolve the merge base with origin/main; validating against the origin/main ref directly.',
      error instanceof Error ? error.message : error,
    )
    return 'origin/main'
  }
}

async function main() {
  const baseline = await resolveLocalBaseline()
  const result = await validateConventionalCommits({ baseline })

  if (result.violations.length === 0) {
    console.log(
      `Conventional Commit policy passed for ${result.commits.length} commit(s) since ${baseline.slice(0, SHORT_SHA_LENGTH)}.`,
    )
    return
  }

  console.error(result.violations.join('\n'))
  process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(String(error))
  process.exitCode = 1
})
