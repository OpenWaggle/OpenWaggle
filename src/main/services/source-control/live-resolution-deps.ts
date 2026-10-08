import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SourceControlProviderId } from '@shared/types/change-request'
import { sourceControlHostKey } from '@shared/types/source-control'
import { networkGitOptions, runGit } from '../../adapters/git/run-git'
import { readProjectSourceControlConfig } from '../../config/project-source-control-config'
import { getSourceControlCliEnv } from '../../env'
import { createLogger } from '../../logger'
import { resolvePrimaryRemote } from '../git/primary-remote'
import { readSourceControlCliHosts } from './cli-host-config'
import type {
  SourceControlRemoteResolutionDeps,
  SourceControlResolutionPreferences,
} from './source-control-remote-resolution'

const execFileAsync = promisify(execFile)
const logger = createLogger('source-control-resolution')

const SSH_CONFIG_TIMEOUT_MS = 3_000
const REMOTE_REFS_TIMEOUT_MS = 15_000
/** Enough to see one change-request ref; a huge ref advertisement is cut, not buffered whole. */
const REMOTE_REFS_MAX_BUFFER_BYTES = 4 * 1024 * 1024
const SSH_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/u

/** Read and update the source-control Settings, whichever process owns them. */
export interface SourceControlPreferencesAccess {
  readonly read: () => Promise<SourceControlResolutionPreferences>
  readonly rememberDetectedHost: (host: string, provider: SourceControlProviderId) => Promise<void>
}

/** `ssh -G` prints the effective config for an alias without connecting. */
export async function resolveSshHostName(alias: string): Promise<string> {
  if (!SSH_ALIAS_PATTERN.test(alias)) return alias
  try {
    const { stdout } = await execFileAsync('ssh', ['-G', '--', alias], {
      env: getSourceControlCliEnv(),
      timeout: SSH_CONFIG_TIMEOUT_MS,
    })
    const line = stdout.split('\n').find((candidate) => candidate.startsWith('hostname '))
    const hostName = line?.slice('hostname '.length).trim()
    return hostName ? hostName : alias
  } catch {
    return alias
  }
}

function credentialHelperProvider(helper: string): SourceControlProviderId | null {
  if (/\bgh(?:\.exe)?\s+auth\s+git-credential\b/u.test(helper)) return 'github'
  if (/\bglab(?:\.exe)?\s+auth\s+git-credential\b/u.test(helper)) return 'gitlab'
  return null
}

/** Per-host `credential.<url>.helper` entries written by `gh auth setup-git` or glab. */
export async function readCredentialHelperProviders(workingPath: string) {
  const result = await runGit(workingPath, [
    'config',
    '--get-regexp',
    String.raw`^credential\..+\.helper$`,
  ])
  const providers: Record<string, SourceControlProviderId> = {}
  if (result.code !== 0) return providers
  for (const line of result.stdout.split('\n')) {
    const match = /^credential\.(?<url>.+)\.helper\s+(?<helper>.+)$/u.exec(line.trim())
    const provider = match?.groups?.helper ? credentialHelperProvider(match.groups.helper) : null
    if (!provider || !match?.groups?.url) continue
    try {
      providers[sourceControlHostKey(new URL(match.groups.url).host)] = provider
    } catch {
      // A helper scoped by something other than a URL names no host.
    }
  }
  return providers
}

/** How long a remote's change-request refs answer is reused, including "none". */
const REMOTE_REFS_CACHE_TTL_MS = 10 * 60_000
const REMOTE_REFS_CACHE_LIMIT = 200

const remoteRefProbes = new Map<
  string,
  { readonly at: number; readonly provider: SourceControlProviderId | null }
>()

/** Forget every remembered remote-refs answer, e.g. when the user asks for a re-check. */
export function forgetRemoteRefProbes() {
  remoteRefProbes.clear()
}

/**
 * Whether a remote advertises GitHub pull or GitLab merge-request refs. Answers are reused for a
 * while, so an undecided host does not cost a network round trip on every status refresh.
 * Gitea and Forgejo also advertise `refs/pull/*`; known public hosts of those are excluded
 * earlier, and the user can change any detected provider.
 */
export async function probeRemoteChangeRequestRefs(
  workingPath: string,
  remoteName: string,
): Promise<SourceControlProviderId | null> {
  const key = `${workingPath}\0${remoteName}`
  const cached = remoteRefProbes.get(key)
  if (cached && Date.now() - cached.at < REMOTE_REFS_CACHE_TTL_MS) return cached.provider
  const provider = await readRemoteChangeRequestRefs(workingPath, remoteName)
  if (remoteRefProbes.size >= REMOTE_REFS_CACHE_LIMIT) {
    const oldest = remoteRefProbes.keys().next().value
    if (oldest !== undefined) remoteRefProbes.delete(oldest)
  }
  remoteRefProbes.set(key, { at: Date.now(), provider })
  return provider
}

async function readRemoteChangeRequestRefs(
  workingPath: string,
  remoteName: string,
): Promise<SourceControlProviderId | null> {
  // ls-remote patterns are globs matched against the end of each ref name.
  const result = await runGit(
    workingPath,
    ['ls-remote', '--refs', remoteName, 'refs/pull/*/head', 'refs/merge-requests/*/head'],
    {
      ...networkGitOptions(REMOTE_REFS_TIMEOUT_MS),
      maxBuffer: REMOTE_REFS_MAX_BUFFER_BYTES,
    },
  )
  const output = result.stdout
  if (result.code !== 0 && output.length === 0) {
    logger.info('Could not read change-request refs from the remote', {
      remoteName,
      error: result.stderr.trim(),
    })
    return null
  }
  if (/\trefs\/pull\/\d+\//u.test(output)) return 'github'
  if (/\trefs\/merge-requests\/\d+\//u.test(output)) return 'gitlab'
  return null
}

export function createLiveSourceControlResolutionDeps(
  preferences: SourceControlPreferencesAccess,
): SourceControlRemoteResolutionDeps {
  return {
    readPrimaryRemote: resolvePrimaryRemote,
    readPreferences: preferences.read,
    readProjectDeclarations: async (projectPath) =>
      (await readProjectSourceControlConfig(projectPath)).hosts,
    readCliHosts: () => readSourceControlCliHosts(),
    readCredentialHelpers: readCredentialHelperProviders,
    resolveSshHostName,
    probeRemoteRefs: probeRemoteChangeRequestRefs,
    rememberDetectedHost: preferences.rememberDetectedHost,
  }
}
