import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { validateConventionalCommits } from './check-conventional-commits'

const execFileAsync = promisify(execFile)

const GIT_MERGE_BASE_MAX_BUFFER_BYTES = 10_000_000
const SHORT_SHA_LENGTH = 12

/**
 * Resolves the baseline for local commit-policy validation, in decreasing order of
 * precision:
 *
 * 1. The merge base with `origin/main`, which scopes the check to this branch's commits
 *    even when local refs are stale.
 * 2. No explicit baseline at all, which lets the validator resolve its own activation
 *    baseline — a commit that always exists in this repository's history. Falling back to
 *    the literal `origin/main` ref would fail closed on clones that never fetched it and
 *    hard-block the pre-push hook.
 */
async function resolveLocalBaseline(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', 'origin/main'], {
      maxBuffer: GIT_MERGE_BASE_MAX_BUFFER_BYTES,
    })
    return stdout.trim() || null
  } catch (error) {
    console.error(
      'Could not resolve the merge base with origin/main; falling back to the policy activation baseline.',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

async function main() {
  const baseline = await resolveLocalBaseline()
  const result = await validateConventionalCommits(baseline === null ? {} : { baseline })

  /*
   * An empty range without an explicit baseline means the validator could not scope this
   * branch's commits (for example a shallow clone where the activation commit is absent).
   * Passing zero commits would be a vacuous pre-push gate, so fail closed with guidance.
   */
  if (baseline === null && result.commits.length === 0) {
    console.error(
      'Could not scope this branch against the commit policy (shallow or partial clone?). Fetch full history with `git fetch --unshallow origin main` and push again.',
    )
    process.exitCode = 1
    return
  }

  if (result.violations.length === 0) {
    const since =
      baseline === null ? 'the policy activation baseline' : baseline.slice(0, SHORT_SHA_LENGTH)
    console.log(
      `Conventional Commit policy passed for ${result.commits.length} commit(s) since ${since}.`,
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
