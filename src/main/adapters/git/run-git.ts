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
}

export interface RunGitOptions {
  readonly maxBuffer?: number
  /** Extra environment variables (e.g. GIT_INDEX_FILE for a scratch index). */
  readonly env?: Readonly<Record<string, string>>
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
