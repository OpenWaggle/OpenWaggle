/**
 * The pre-commit hook (`.husky/pre-commit`): formats the staged files with oxfmt and restages
 * them, so a commit never carries a formatting diff. Only staged files are touched, so it stays
 * well under a second.
 *
 * A file that also has unstaged changes is not formatted: formatting it and restaging it would
 * commit the unstaged hunks too. The hook names it, and the CI format check still covers it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'

/** oxfmt's config files; without one oxfmt formats with its own defaults, not the repository's. */
const OXFMT_CONFIG_FILES = [
  '.oxfmtrc.json',
  '.oxfmtrc.jsonc',
  'oxfmt.config.ts',
  'oxfmt.config.mts',
]
const GIT_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024

export interface PreCommitPlan {
  /** Staged files to format and restage. */
  readonly format: readonly string[]
  /** Staged files with unstaged changes, left as they are. */
  readonly partiallyStaged: readonly string[]
}

/** Which staged files the hook formats. */
export function planPreCommitFormat(staged: readonly string[], unstaged: readonly string[]) {
  const unstagedSet = new Set(unstaged)
  const plan: PreCommitPlan = {
    format: staged.filter((file) => !unstagedSet.has(file)),
    partiallyStaged: staged.filter((file) => unstagedSet.has(file)),
  }
  return plan
}

/** Splits `git ... -z` output into paths. */
export function nulSeparated(output: string) {
  return output.split('\0').filter((file) => file.length > 0)
}

function isRegularFile(file: string) {
  try {
    return lstatSync(file).isFile()
  } catch {
    return false
  }
}

function git(args: readonly string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: GIT_OUTPUT_LIMIT_BYTES })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

function main() {
  if (!OXFMT_CONFIG_FILES.some((file) => existsSync(file))) {
    console.log('pre-commit: no oxfmt config at the repository root; skipping formatting.')
    return
  }
  // Regular files only: a submodule or a symlink to a directory would make oxfmt format a tree.
  const staged = nulSeparated(
    git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']),
  ).filter(isRegularFile)
  if (staged.length === 0) {
    return
  }
  const plan = planPreCommitFormat(staged, nulSeparated(git(['diff', '--name-only', '-z'])))
  for (const file of plan.partiallyStaged) {
    console.log(
      `pre-commit: ${file} has unstaged changes, so it was not formatted; run \`bunx oxfmt ${file}\`.`,
    )
  }
  if (plan.format.length === 0) {
    return
  }
  const formatted = spawnSync(
    'bunx',
    ['--no-install', 'oxfmt', '--no-error-on-unmatched-pattern', ...plan.format],
    {
      encoding: 'utf8',
    },
  )
  if (formatted.status !== 0) {
    console.error(`pre-commit: oxfmt failed.\n${formatted.stdout}${formatted.stderr}`.trimEnd())
    process.exitCode = 1
    return
  }
  git(['add', '--', ...plan.format])
}

if (import.meta.main) {
  main()
}
