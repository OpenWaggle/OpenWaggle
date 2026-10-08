import type { SourceControlFailure } from '@shared/types/git'
import type { CliResult } from './cli-runner'

export function cliMissingFailure(): SourceControlFailure {
  return { ok: false, code: 'cli-missing', message: 'GitHub CLI (gh) is not installed.' }
}

function notAuthenticatedFailure(detail: string): SourceControlFailure {
  return {
    ok: false,
    code: 'not-authenticated',
    message: detail || 'Not authenticated with GitHub. Run `gh auth login`.',
  }
}

function unknownFailure(detail: string): SourceControlFailure {
  return { ok: false, code: 'unknown', message: detail || 'GitHub CLI command failed.' }
}

export function invalidRepositoryFailure(): SourceControlFailure {
  return {
    ok: false,
    code: 'invalid-target',
    message: 'GitHub CLI returned a pull request outside the approved repository.',
  }
}

/** What a failed gh command means for OpenWaggle. */
export function classifyFailure(result: CliResult): SourceControlFailure {
  if (result.missing) return cliMissingFailure()
  const lower = result.stderr.toLowerCase()
  if (lower.includes('no pull requests found') || lower.includes('not found')) {
    return { ok: false, code: 'no-change-request', message: 'No pull request found for ref.' }
  }
  if (/auth|logged in|authentication/i.test(result.stderr)) {
    return notAuthenticatedFailure(result.stderr.trim())
  }
  return unknownFailure(result.stderr.trim())
}
