import type { SourceControlProviderId } from '@shared/types/change-request'
import {
  publicSourceControlProvider,
  type SourceControlProviderSource,
} from '@shared/types/source-control'
import type { SourceControlCliHosts } from './cli-host-config'

type HostProviders = Readonly<Record<string, SourceControlProviderId>>

/** Everything OpenWaggle knows about hosts without contacting a server. */
export interface SourceControlHostSignals {
  readonly userChoices: HostProviders
  /** Only declarations the user approved for the Session's project. */
  readonly approvedDeclarations: HostProviders
  readonly cliHosts: SourceControlCliHosts
  /** Providers named by per-host `gh`/`glab` git credential helpers. */
  readonly credentialHelpers: HostProviders
  /** Providers learned earlier from a remote's change-request refs. */
  readonly detectedHosts: HostProviders
}

export interface SourceControlHostProviderDecision {
  readonly provider: SourceControlProviderId
  readonly source: SourceControlProviderSource
}

function decided(
  provider: SourceControlProviderId | undefined,
  source: SourceControlProviderSource,
): SourceControlHostProviderDecision | null {
  return provider ? { provider, source } : null
}

function cliSignInProvider(host: string, cliHosts: SourceControlCliHosts) {
  const github = cliHosts.github.some((entry) => entry.host === host)
  const gitlab = cliHosts.gitlab.some((entry) => entry.host === host)
  if (github === gitlab) return undefined
  return github ? 'github' : 'gitlab'
}

function hostNameProvider(host: string): SourceControlProviderId | undefined {
  if (host.includes('github')) return 'github'
  if (host.includes('gitlab')) return 'gitlab'
  return undefined
}

/**
 * Decide a host's provider from offline signals, in ADR 0048 order. A null result means the
 * caller may check the remote's refs and otherwise asks the user once. `owner` is the remote
 * path before the repository name; GitHub only ever has one segment there.
 */
export function decideSourceControlHostProvider(
  host: string,
  owner: string,
  signals: SourceControlHostSignals,
): SourceControlHostProviderDecision | null {
  return (
    decided(signals.userChoices[host], 'user-choice') ??
    decided(signals.approvedDeclarations[host], 'project-declaration') ??
    decided(publicSourceControlProvider(host), 'public-host') ??
    decided(cliSignInProvider(host, signals.cliHosts), 'cli-sign-in') ??
    decided(signals.credentialHelpers[host], 'git-credential-helper') ??
    decided(owner.includes('/') ? 'gitlab' : undefined, 'repository-path') ??
    decided(hostNameProvider(host), 'host-name') ??
    decided(signals.detectedHosts[host], 'remote-refs')
  )
}
