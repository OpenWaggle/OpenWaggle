import type { SourceControlFailure } from '@shared/types/git'
import type { CliResult } from './cli-runner'

export function cliMissingFailure() {
  const failure: SourceControlFailure = {
    ok: false,
    code: 'cli-missing',
    message: 'GitHub CLI (gh) is not installed.',
  }
  return failure
}

function notAuthenticatedFailure(detail: string) {
  const failure: SourceControlFailure = {
    ok: false,
    code: 'not-authenticated',
    message: detail || 'Not authenticated with GitHub. Run `gh auth login`.',
  }
  return failure
}

function unknownFailure(detail: string) {
  const failure: SourceControlFailure = {
    ok: false,
    code: 'unknown',
    message: detail || 'GitHub CLI command failed.',
  }
  return failure
}

export function invalidRepositoryFailure() {
  const failure: SourceControlFailure = {
    ok: false,
    code: 'invalid-target',
    message: 'GitHub CLI returned a pull request outside the approved repository.',
  }
  return failure
}

/** What a failed gh command means for OpenWaggle. */
export function classifyFailure(result: CliResult) {
  if (result.missing) return cliMissingFailure()
  const lower = result.stderr.toLowerCase()
  if (lower.includes('no pull requests found') || lower.includes('not found')) {
    const failure: SourceControlFailure = {
      ok: false,
      code: 'no-change-request',
      message: 'No pull request found for ref.',
    }
    return failure
  }
  if (/auth|logged in|authentication/i.test(result.stderr)) {
    return notAuthenticatedFailure(result.stderr.trim())
  }
  return unknownFailure(result.stderr.trim())
}
