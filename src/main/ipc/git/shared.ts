import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { BYTES_PER_KIBIBYTE, DOUBLE_FACTOR } from '@shared/constants/constants'
import { jsonObjectSchema } from '@shared/schemas/validation'
import { z } from 'zod'

const MODULE_VALUE_5 = 5

export const execFileAsync = promisify(execFile)
export const DEFAULT_GIT_MAX_BUFFER = MODULE_VALUE_5 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE

export interface GitExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

export interface RunGitOptions {
  readonly maxBuffer?: number
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
    })
    if (typeof output === 'string') {
      return { stdout: output, stderr: '', code: 0 }
    }
    return {
      stdout: output.stdout ?? '',
      stderr: output.stderr ?? '',
      code: 0,
    }
  } catch (err) {
    const result = jsonObjectSchema.safeParse(err)
    if (result.success) {
      const e = result.data
      return {
        stdout: typeof e.stdout === 'string' ? e.stdout : '',
        stderr:
          typeof e.stderr === 'string'
            ? e.stderr
            : typeof e.message === 'string'
              ? e.message
              : 'Git command failed',
        code: typeof e.code === 'number' ? e.code : 1,
      }
    }
    return {
      stdout: '',
      stderr: err instanceof Error ? err.message : 'Git command failed',
      code: 1,
    }
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

export const projectPathSchema = z
  .string()
  .min(1)
  .refine((p) => path.isAbsolute(p), { message: 'Project path must be absolute' })
