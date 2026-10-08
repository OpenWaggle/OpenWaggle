import { createLogger } from '../../logger'
import { readSourceControlCliHosts } from '../../services/source-control/cli-host-config'
import { getSourceControlCliEnvForAccountToken } from '../../services/source-control/source-control-environment'
import { type CliResult, runCli } from './cli-runner'

const logger = createLogger('source-control-github-accounts')

/** gh errors that mean "this account cannot see the repository", not "nothing found there". */
const REPOSITORY_ACCESS_FAILURE =
  /Could not resolve to a Repository|HTTP 404|HTTP 403|Resource not accessible by|SAML enforcement|single sign-on|\bSSO\b/iu

/** The remembered Provider account for one repository, and how to remember a new one. */
export interface ProviderAccountPreference {
  readonly preferredLogin: string | null
  readonly remember: (login: string) => Promise<void>
}

/** Runs repository-scoped gh commands as the account that can see the repository. */
export interface GithubAccountRunner {
  /** A read: retried with each other account while the repository is not visible. */
  readonly run: (args: readonly string[], cwd: string) => Promise<CliResult>
  /**
   * A write (create, merge, checkout): run once, as the account an earlier read chose, else the
   * remembered account, else gh's active account. A write is never retried as someone else.
   */
  readonly runWrite: (args: readonly string[], cwd: string) => Promise<CliResult>
  /** The account the last successful command ran as, when known. */
  readonly account: () => string | null
  /** Every account tried when none could see the repository; null otherwise. */
  readonly unreachableBy: () => readonly string[] | null
}

interface AccountCandidate {
  readonly login: string
  readonly active: boolean
}

function unreadableTokenResult(login: string): CliResult {
  return {
    stdout: '',
    stderr: `Could not read the stored gh sign-in for @${login}. Sign in again with gh auth login.`,
    code: 1,
    missing: false,
  }
}

export function isRepositoryAccessFailure(result: CliResult) {
  return result.code !== 0 && !result.missing && REPOSITORY_ACCESS_FAILURE.test(result.stderr)
}

function orderedCandidates(accounts: readonly AccountCandidate[], preferred: string | null) {
  const preferredAccount = accounts.find((account) => account.login === preferred)
  const active = accounts.find((account) => account.active)
  const ordered = [preferredAccount, active, ...accounts].filter(
    (account): account is AccountCandidate => account !== undefined,
  )
  return [...new Map(ordered.map((account) => [account.login, account])).values()]
}

/**
 * A gh runner for one host that keeps the user's active account unless it cannot see the
 * repository, then tries each other account gh holds for that host with that account's own token
 * (`gh auth token --user`), for that one command only (ADR 0048). gh's active account is never
 * switched, and inherited token variables stay stripped.
 */
export function createGithubAccountRunner(
  host: string,
  preference: ProviderAccountPreference,
): GithubAccountRunner {
  let chosen: AccountCandidate | null = null
  let chosenEnv: Readonly<Record<string, string | undefined>> | undefined
  let lastAccount: string | null = null
  let unreachable: readonly string[] | null = null

  async function envFor(candidate: AccountCandidate, cwd: string) {
    if (candidate.active) return { ok: true as const, env: undefined }
    const token = await runCli(
      'gh',
      ['auth', 'token', '--hostname', host, '--user', candidate.login],
      cwd,
    )
    const value = token.stdout.trim()
    if (token.code !== 0 || !value) return { ok: false as const }
    return { ok: true as const, env: getSourceControlCliEnvForAccountToken('github', host, value) }
  }

  async function runAs(candidate: AccountCandidate, args: readonly string[], cwd: string) {
    const env = await envFor(candidate, cwd)
    if (!env.ok) return null
    const result = await runCli('gh', args, cwd, env.env ? { env: env.env } : {})
    return { result, env: env.env }
  }

  /** Remember a non-active account that works, and replace a remembered one that lost access. */
  async function rememberIfNew(candidate: AccountCandidate) {
    const rememberable = !candidate.active || preference.preferredLogin !== null
    if (candidate.login === preference.preferredLogin || !rememberable) return
    await preference.remember(candidate.login).catch((error: unknown) => {
      logger.warn('Could not remember the GitHub account for a repository', {
        host,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  async function run(args: readonly string[], cwd: string): Promise<CliResult> {
    unreachable = null
    const refused: string[] = []
    let last: CliResult | null = null
    if (chosen) {
      const result = await runCli('gh', args, cwd, chosenEnv ? { env: chosenEnv } : {})
      if (!isRepositoryAccessFailure(result)) return result
      refused.push(chosen.login)
      last = result
    }
    const hosts = await readSourceControlCliHosts()
    const accounts = hosts.github.find((entry) => entry.host === host.toLowerCase())?.accounts ?? []
    // An account that was just refused is not asked again for this command.
    const candidates = orderedCandidates(accounts, preference.preferredLogin).filter(
      (candidate) => !refused.includes(candidate.login),
    )
    if (candidates.length === 0 && last === null) return runCli('gh', args, cwd)
    const tried: string[] = [...refused]
    for (const candidate of candidates) {
      const attempt = await runAs(candidate, args, cwd)
      if (!attempt) continue
      tried.push(candidate.login)
      last = attempt.result
      if (isRepositoryAccessFailure(attempt.result)) continue
      chosen = candidate
      chosenEnv = attempt.env
      lastAccount = candidate.login
      if (attempt.result.code === 0) await rememberIfNew(candidate)
      return attempt.result
    }
    unreachable = tried
    return last ?? runCli('gh', args, cwd)
  }

  async function runWrite(args: readonly string[], cwd: string): Promise<CliResult> {
    unreachable = null
    if (chosen) return runCli('gh', args, cwd, chosenEnv ? { env: chosenEnv } : {})
    const hosts = await readSourceControlCliHosts()
    const accounts = hosts.github.find((entry) => entry.host === host.toLowerCase())?.accounts ?? []
    const remembered = accounts.find((account) => account.login === preference.preferredLogin)
    const candidate = remembered ?? accounts.find((account) => account.active)
    if (!candidate) return runCli('gh', args, cwd)
    const attempt = await runAs(candidate, args, cwd)
    // Never fall back to another identity for a write: say which account could not be used.
    if (!attempt) return unreadableTokenResult(candidate.login)
    lastAccount = candidate.login
    return attempt.result
  }

  return { run, runWrite, account: () => lastAccount, unreachableBy: () => unreachable }
}
