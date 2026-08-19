import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DOUBLE_FACTOR } from '@shared/constants/math'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import { getEnvWithOverrides } from '../../env'

const MODULE_VALUE_5 = 5

export const execFileAsync = promisify(execFile)
export const DEFAULT_GIT_MAX_BUFFER = MODULE_VALUE_5 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE
/** Larger buffer for diff output, which can dwarf status/porcelain output. */
export const DIFF_GIT_MAX_BUFFER = 8 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE

export interface GitExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
  /**
   * The command produced more output than `maxBuffer` allowed and was killed.
   *
   * Node reports this with a non-numeric error code, which normalises to `code: 1` and an empty
   * stderr - indistinguishable from an ordinary git failure. Callers that can hit it (diffs of
   * generated files, lockfiles, large vendored changes) need to tell the user their output was
   * too large rather than that git failed for no stated reason.
   */
  readonly maxBufferExceeded?: boolean
}

/** Node's error code when a child is killed for exceeding `maxBuffer`. */
const MAX_BUFFER_ERROR_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

export interface RunGitOptions {
  readonly maxBuffer?: number
  /** Extra environment variables (e.g. GIT_INDEX_FILE for a scratch index). */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Kill the command after this long.
   *
   * Required for anything that talks to a remote. Without it a command reaching the network blocks
   * for git's own connect timeout - minutes - or forever on a credential prompt, and these calls sit
   * on interactive paths: a diff load, a cached status refresh, the gate a Commit & push waits for.
   */
  readonly timeoutMs?: number
}

function normalizeGitSuccess(output: string | { stdout?: string; stderr?: string }): GitExecResult {
  if (typeof output === 'string') {
    return { stdout: output, stderr: '', code: 0 }
  }
  return {
    stdout: output.stdout ?? '',
    stderr: output.stderr ?? '',
    code: 0,
  }
}

function normalizeGitError(error: unknown): GitExecResult {
  const result = safeDecodeUnknown(jsonObjectSchema, error)
  if (!result.success) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Git command failed',
      code: 1,
    }
  }

  const value = result.data
  const fallbackMessage = typeof value.message === 'string' ? value.message : 'Git command failed'
  return {
    stdout: typeof value.stdout === 'string' ? value.stdout : '',
    stderr: typeof value.stderr === 'string' ? value.stderr : fallbackMessage,
    code: typeof value.code === 'number' ? value.code : 1,
    ...(value.code === MAX_BUFFER_ERROR_CODE ? { maxBufferExceeded: true } : {}),
  }
}

export async function runGit(
  projectPath: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<GitExecResult> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER
  try {
    const output = await execFileAsync('git', args, {
      cwd: projectPath,
      maxBuffer,
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      ...(options.env ? { env: getEnvWithOverrides(options.env) } : {}),
    })
    return normalizeGitSuccess(output)
  } catch (error) {
    return normalizeGitError(error)
  }
}

export async function isGitRepository(projectPath: string): Promise<boolean> {
  const result = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree'])
  return result.code === 0 && result.stdout.trim() === 'true'
}

export function stripSurroundingQuotes(value: string): string {
  if (value.length >= DOUBLE_FACTOR && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\"', '"')
  }
  return value
}
