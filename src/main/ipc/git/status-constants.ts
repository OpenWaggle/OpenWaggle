export { DIFF_GIT_MAX_BUFFER } from '../../adapters/git/run-git'

export const GIT_STATUS_CODE_WIDTH = 3
export const GIT_STATUS_PATH_OFFSET = 3
export const GIT_NUMSTAT_PATH_OFFSET = 2
export const GIT_PARSE_INT_RADIX = 10

/**
 * Report paths verbatim, not C-quoted.
 *
 * `core.quotePath` defaults to true, so git prints `"caf\\303\\251.txt"` for any path with
 * non-ASCII or special bytes - and the parser could only strip the quotes, leaving the escape
 * sequence as a literal. Those parsed paths are the pathspec of every panel commit, so a single
 * accented filename anywhere in the working tree made staging fail with
 * "pathspec ... did not match any files" and committed nothing. Verified against real git.
 *
 * Applied to the reads whose output becomes a path we hand back to git.
 */
export const GIT_RAW_PATHS = ['-c', 'core.quotePath=false'] as const

/**
 * Treat every pathspec as a literal path.
 *
 * Pathspecs are globs by default, so a filename containing glob syntax reaches files the user did not
 * select: verified that `git add -- 'file[ab].txt'` also stages `filea.txt`. Every path here comes from
 * `git status`, i.e. it is already an exact path, so glob expansion can only ever be wrong.
 */
export const GIT_LITERAL_PATHS = ['--literal-pathspecs'] as const
