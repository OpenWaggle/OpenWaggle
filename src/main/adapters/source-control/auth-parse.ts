import type { SourceControlAuthStatus } from '@shared/types/git'

/**
 * Parse `gh auth status` output into a structured auth status.
 * gh prints lines like:
 *   github.com
 *     ✓ Logged in to github.com account octocat (keyring)
 * or, when unauthenticated, exits non-zero with "not logged in".
 */
export function parseGhAuthStatus(stdout: string, stderr: string): SourceControlAuthStatus {
  const combined = `${stdout}\n${stderr}`
  const accountMatch = /Logged in to (\S+) account (\S+)/i.exec(combined)
  if (accountMatch) {
    const [, host, account] = accountMatch
    return { authenticated: true, host: host ?? null, account: account ?? null }
  }
  const loggedInHost = /Logged in to (\S+)/i.exec(combined)
  if (loggedInHost) {
    const [, host] = loggedInHost
    return { authenticated: true, host: host ?? null, account: null }
  }
  return { authenticated: false, host: null, account: null }
}

/**
 * Parse `glab auth status` output. glab prints lines like:
 *   gitlab.com
 *     ✓ Logged in to gitlab.com as octocat (...)
 */
export function parseGlabAuthStatus(stdout: string, stderr: string): SourceControlAuthStatus {
  const combined = `${stdout}\n${stderr}`
  const asMatch = /Logged in to (\S+) as (\S+)/i.exec(combined)
  if (asMatch) {
    const [, host, account] = asMatch
    return { authenticated: true, host: host ?? null, account: account ?? null }
  }
  const loggedInHost = /Logged in to (\S+)/i.exec(combined)
  if (loggedInHost) {
    const [, host] = loggedInHost
    return { authenticated: true, host: host ?? null, account: null }
  }
  return { authenticated: false, host: null, account: null }
}
