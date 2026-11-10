/** `git` for the agent gate, through the quality gates' bounded process runner. */
import type { RunProcess } from '../agent-quality-gates/process'

const ROOT_TIMEOUT_MS = 15_000

/** `git <args>` in `cwd`; stdout on success, undefined on any failure. */
export async function git(
  run: RunProcess,
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string | undefined> {
  const result = await run('git', args, { cwd, timeoutMs })
  return result.code === 0 ? result.stdout : undefined
}

export async function repositoryRoot(run: RunProcess, cwd: string) {
  return (await git(run, cwd, ['rev-parse', '--show-toplevel'], ROOT_TIMEOUT_MS))?.trim()
}

/** Why a tool run produced no usable result; `code: null` means it timed out or never started. */
export function failureReason(result: {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}) {
  if (result.code === null) return 'did not finish: timed out or could not start'
  const firstLine = (result.stderr.trim() || result.stdout.trim()).split('\n')[0] ?? ''
  return firstLine === ''
    ? `exited with code ${result.code}`
    : firstLine.slice(0, MAX_REASON_LENGTH)
}

const MAX_REASON_LENGTH = 160
