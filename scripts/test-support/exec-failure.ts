/** What a rejected `execFile` promise carries once the child ran and exited non-zero. */
export interface ExecFailure {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

/**
 * Narrows an `execFile` rejection to the exit code and output it carries. Rejections without a
 * numeric exit code (a missing binary, a signal) are thrown again, since tests expect a real exit.
 */
export function execFailure(rejection: unknown) {
  const error = rejection
  if (typeof error !== 'object' || error === null) throw rejection
  if (!('code' in error) || typeof error.code !== 'number') throw rejection
  return {
    stdout: 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '',
    stderr: 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '',
    code: error.code,
  } satisfies ExecFailure
}
