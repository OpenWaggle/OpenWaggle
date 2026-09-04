import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import { getGhCliEnv } from '../../env'

const execFileAsync = promisify(execFile)
const SOURCE_CONTROL_CLI_TIMEOUT_MS = 60_000

export interface CliResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
  /** True when the executable itself was not found (ENOENT). */
  readonly missing: boolean
}

/**
 * Run a CLI tool (gh/glab) without throwing. Returns a normalized result;
 * a missing executable is reported via `missing: true` rather than throwing.
 */
export async function runCli(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<CliResult> {
  try {
    const output = await execFileAsync(command, [...args], {
      cwd,
      env: getGhCliEnv(),
      timeout: SOURCE_CONTROL_CLI_TIMEOUT_MS,
    })
    return { stdout: output.stdout ?? '', stderr: output.stderr ?? '', code: 0, missing: false }
  } catch (error) {
    return normalizeCliError(error)
  }
}

function normalizeCliError(error: unknown): CliResult {
  const decoded = safeDecodeUnknown(jsonObjectSchema, error)
  const record = decoded.success ? decoded.data : {}
  const errorCode = typeof record.code === 'string' ? record.code : null
  // ENOENT: binary not found; EACCES: found but not executable — both mean the
  // provider CLI is unusable, so treat them the same (surface as unavailable).
  const missing = errorCode === 'ENOENT' || errorCode === 'EACCES'
  return {
    stdout: typeof record.stdout === 'string' ? record.stdout : '',
    stderr:
      typeof record.stderr === 'string'
        ? record.stderr
        : error instanceof Error
          ? error.message
          : 'CLI command failed',
    code: typeof record.code === 'number' ? record.code : 1,
    missing,
  }
}
