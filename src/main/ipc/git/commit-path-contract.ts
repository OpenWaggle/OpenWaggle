import {
  GIT_SELECTED_PATH_BYTE_LIMIT,
  GIT_SELECTED_PATH_COUNT_LIMIT,
  selectedGitPathsByteLength,
} from '@shared/schemas/git-requests'

export {
  GIT_SELECTED_PATH_BYTE_LIMIT,
  GIT_SELECTED_PATH_COUNT_LIMIT,
} from '@shared/schemas/git-requests'

/** Protect direct main-process callers and rename-source expansion, which can add paths after IPC decoding. */
export function validateSelectedGitPaths(paths: readonly string[]): string | null {
  if (paths.length > GIT_SELECTED_PATH_COUNT_LIMIT) {
    return `Select at most ${String(GIT_SELECTED_PATH_COUNT_LIMIT)} files in one commit.`
  }
  for (const gitPath of paths) {
    if (gitPath.length === 0) return 'Selected Git paths cannot be empty.'
    if (gitPath.includes('\0')) return 'Selected Git paths cannot contain NUL bytes.'
  }
  if (selectedGitPathsByteLength(paths) > GIT_SELECTED_PATH_BYTE_LIMIT) {
    return `Selected Git paths exceed the ${String(GIT_SELECTED_PATH_BYTE_LIMIT)} byte limit.`
  }
  return null
}

/** Git's `--pathspec-file-nul` and `update-index -z --stdin` wire format. */
export function encodeSelectedGitPaths(paths: readonly string[]) {
  return paths.length === 0 ? '' : `${paths.join('\0')}\0`
}
