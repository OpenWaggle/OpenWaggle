import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SourceControlProviderAccount } from '@shared/types/source-control'
import { isSourceControlHostName, sourceControlHostKey } from '@shared/types/source-control'
import { parse } from 'yaml'
import { createLogger } from '../../logger'
import { getSourceControlCliConfigDirectories } from './source-control-environment'

const logger = createLogger('source-control-cli-hosts')

/** Upper bound on hosts read from one CLI config, so a huge file cannot grow every lookup. */
const MAX_CLI_HOSTS = 200
const MAX_ACCOUNTS_PER_HOST = 50

export interface GithubCliHost {
  readonly host: string
  readonly accounts: readonly SourceControlProviderAccount[]
}

export interface GitlabCliHost {
  readonly host: string
  /** Alternate hostname glab uses for SSH git operations on this instance. */
  readonly sshHost: string | null
  readonly accounts: readonly SourceControlProviderAccount[]
}

export interface SourceControlCliHosts {
  readonly github: readonly GithubCliHost[]
  readonly gitlab: readonly GitlabCliHost[]
}

export interface SourceControlCliConfigDirectories {
  readonly gh: readonly string[]
  readonly glab: readonly string[]
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function readFirstYaml(directories: readonly string[], fileName: string) {
  for (const directory of directories) {
    let raw: string
    try {
      raw = await readFile(join(directory, fileName), 'utf-8')
    } catch {
      continue
    }
    try {
      const parsed: unknown = parse(raw)
      return isRecord(parsed) ? parsed : null
    } catch (error) {
      logger.warn('Could not parse a source-control CLI config file', {
        file: join(directory, fileName),
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
  return null
}

/** A gh host entry's account members, each still unchecked. */
interface GithubHostEntryFields {
  readonly user?: unknown
  readonly users?: unknown
}

/** A glab host entry's sign-in members, each still unchecked. */
interface GitlabHostEntryFields {
  readonly user?: unknown
  readonly token?: unknown
  readonly ssh_host?: unknown
}

function githubAccounts(entry: GithubHostEntryFields) {
  const active = nonEmptyString(entry.user)
  const logins = isRecord(entry.users) ? Object.keys(entry.users) : active ? [active] : []
  return logins
    .slice(0, MAX_ACCOUNTS_PER_HOST)
    .map((login) => ({ login, active: login === active }))
}

/** gh writes one top-level key per host to `hosts.yml`. */
function parseGithubHosts(config: Readonly<Record<string, unknown>> | null): GithubCliHost[] {
  if (!config) return []
  return Object.entries(config)
    .slice(0, MAX_CLI_HOSTS)
    .flatMap(([host, entry]) =>
      isRecord(entry)
        ? [{ host: sourceControlHostKey(host), accounts: githubAccounts(entry) }]
        : [],
    )
}

/** glab keeps instances under `hosts:` in `config.yml`; a token or user means signed in. */
function parseGitlabHosts(config: Readonly<Record<string, unknown>> | null): GitlabCliHost[] {
  const gitlabConfig: { readonly hosts?: unknown } | null = config
  const hosts = gitlabConfig?.hosts
  if (!isRecord(hosts)) return []
  return Object.entries(hosts)
    .slice(0, MAX_CLI_HOSTS)
    .flatMap(([host, entry]) => {
      if (!isRecord(entry) || !isSourceControlHostName(sourceControlHostKey(host))) return []
      const fields: GitlabHostEntryFields = entry
      const user = nonEmptyString(fields.user)
      const signedIn = user !== null || nonEmptyString(fields.token) !== null
      const sshHost = nonEmptyString(fields.ssh_host)
      return [
        {
          host: sourceControlHostKey(host),
          sshHost:
            sshHost && isSourceControlHostName(sourceControlHostKey(sshHost))
              ? sourceControlHostKey(sshHost)
              : null,
          accounts: signedIn ? [{ login: user ?? 'signed in', active: true }] : [],
        },
      ]
    })
}

/**
 * The hosts gh and glab are configured for, read from their config files without any network
 * call. Tokens are never read into the result.
 */
export async function readSourceControlCliHosts(
  directories: SourceControlCliConfigDirectories = getSourceControlCliConfigDirectories(),
): Promise<SourceControlCliHosts> {
  const [gh, glab] = await Promise.all([
    readFirstYaml(directories.gh, 'hosts.yml'),
    readFirstYaml(directories.glab, 'config.yml'),
  ])
  return { github: parseGithubHosts(gh), gitlab: parseGitlabHosts(glab) }
}
