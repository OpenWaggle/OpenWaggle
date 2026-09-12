import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'

/** Maximum number of selected files accepted by one commit IPC request. */
export const GIT_SELECTED_PATH_COUNT_LIMIT = 10_000
/** Maximum UTF-8 bytes, including NUL separators, accepted for selected commit paths. */
export const GIT_SELECTED_PATH_BYTE_LIMIT = 4 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE

const selectedGitPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((gitPath) => !gitPath.includes('\0') || 'Git paths cannot contain NUL bytes.'),
)

function selectedPathPayloadBytes(paths: readonly string[]) {
  let bytes = 0
  for (const gitPath of paths) {
    bytes += Buffer.byteLength(gitPath, 'utf8') + 1
    if (bytes > GIT_SELECTED_PATH_BYTE_LIMIT) return bytes
  }
  return bytes
}

/** Shared by both renderer-accessible commit entry points. */
export const selectedGitPathsSchema = Schema.Array(selectedGitPathSchema).pipe(
  Schema.maxItems(GIT_SELECTED_PATH_COUNT_LIMIT),
  Schema.filter(
    (paths) =>
      selectedPathPayloadBytes(paths) <= GIT_SELECTED_PATH_BYTE_LIMIT ||
      `Selected Git paths exceed the ${String(GIT_SELECTED_PATH_BYTE_LIMIT)} byte limit.`,
  ),
)

/** Protect direct main-process callers and rename-source expansion, which can add paths after IPC decoding. */
export function validateSelectedGitPaths(paths: readonly string[]): string | null {
  if (paths.length > GIT_SELECTED_PATH_COUNT_LIMIT) {
    return `Select at most ${String(GIT_SELECTED_PATH_COUNT_LIMIT)} files in one commit.`
  }
  for (const gitPath of paths) {
    if (gitPath.length === 0) return 'Selected Git paths cannot be empty.'
    if (gitPath.includes('\0')) return 'Selected Git paths cannot contain NUL bytes.'
  }
  if (selectedPathPayloadBytes(paths) > GIT_SELECTED_PATH_BYTE_LIMIT) {
    return `Selected Git paths exceed the ${String(GIT_SELECTED_PATH_BYTE_LIMIT)} byte limit.`
  }
  return null
}

/** Git's `--pathspec-file-nul` and `update-index -z --stdin` wire format. */
export function encodeSelectedGitPaths(paths: readonly string[]) {
  return paths.length === 0 ? '' : `${paths.join('\0')}\0`
}
