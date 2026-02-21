import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

export const execFileAsync = promisify(execFile)
export const DEFAULT_GIT_MAX_BUFFER = 5 * 1024 * 1024
export const DIFF_GIT_MAX_BUFFER = 32 * 1024 * 1024

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
    const error = err as {
      stdout?: string
      stderr?: string
      code?: number
      message?: string
    }
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? 'Git command failed',
      code: typeof error.code === 'number' ? error.code : 1,
    }
  }
}

export async function isGitRepository(projectPath: string): Promise<boolean> {
  const result = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree'])
  return result.code === 0 && result.stdout.trim() === 'true'
}

export function stripSurroundingQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\"', '"')
  }
  return value
}

export const projectPathSchema = z
  .string()
  .min(1)
  .refine((p) => path.isAbsolute(p), { message: 'Project path must be absolute' })
