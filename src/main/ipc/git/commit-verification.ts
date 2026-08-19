import type { GitCommitFailure } from '@shared/types/git'
import { runGit } from './shared'
import { GIT_RAW_PATHS } from './status-constants'

function commitFailure(code: GitCommitFailure['code'], message: string): GitCommitFailure {
  return { ok: false, code, message }
}

/** `-z` output: NUL-separated, with a trailing separator. */
function splitNulSeparated(output: string) {
  return output.split('\0').filter((entry) => entry.length > 0)
}

/** The paths the index holds changes for, in the index's own spelling. */
export async function stagedPaths(projectPath: string) {
  const staged = await runGit(projectPath, [
    ...GIT_RAW_PATHS,
    'diff',
    '--cached',
    '--name-only',
    '-z',
  ])
  return staged.code === 0 ? new Set(splitNulSeparated(staged.stdout)) : new Set<string>()
}

/**
 * Selected paths the commit was supposed to record and did not.
 *
 * Asked of the result rather than predicted from the paths, because predicting it is what kept going wrong. On
 * a case-insensitive filesystem git's pathspec matching resolves a spelling onto whichever entry the index
 * already holds, and the effects vary by shape: the change may be dropped from the commit entirely, or recorded
 * under the *other* spelling. Three successive attempts to recognise the dangerous shapes by comparing path
 * strings were each wrong in one direction or the other - refusing renames git performs happily, or missing
 * ones it silently mangles. Comparing what was asked against what was recorded needs no such judgement.
 */
export async function findOmittedPaths(
  projectPath: string,
  input: { readonly intended: readonly string[]; readonly stagedBefore: ReadonlySet<string> },
): Promise<readonly string[] | null> {
  const recorded = await runGit(projectPath, [
    ...GIT_RAW_PATHS,
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-z',
    'HEAD',
  ])
  if (recorded.code !== 0) return null

  const committed = new Set(splitNulSeparated(recorded.stdout))
  const omitted = input.intended.filter(
    (candidate) => input.stagedBefore.has(candidate) && !committed.has(candidate),
  )
  return omitted.length > 0 ? omitted : null
}

/**
 * Undo the commit just created and report what it left out.
 *
 * `--soft`, so the index and working tree are exactly as the user left them: nothing of their work is touched,
 * and the change is still theirs to make. Safe because this commit was created moments ago by this function.
 */
export async function undoIncompleteCommit(
  projectPath: string,
  omitted: readonly string[],
): Promise<GitCommitFailure> {
  const hasParent = await runGit(projectPath, ['rev-parse', '-q', '--verify', 'HEAD^'])
  const undo =
    hasParent.code === 0
      ? await runGit(projectPath, ['reset', '--soft', 'HEAD^'])
      : await runGit(projectPath, ['update-ref', '-d', 'HEAD'])

  const listed = omitted.join(', ')
  return commitFailure(
    'case-only-rename',
    undo.code === 0
      ? `Git could not record ${listed} as named - on this filesystem it resolves onto a differently-cased path already tracked. Nothing was committed. Rename through a temporary name, or commit it from the command line.`
      : `Git could not record ${listed} as named, and undoing the incomplete commit failed: ${undo.stderr.trim()}`,
  )
}
