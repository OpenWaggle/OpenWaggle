import type {
  SourceControlProviderId,
  SourceControlRepositoryIdentity,
} from '@shared/types/change-request'
import {
  isSourceControlHostName,
  publicSourceControlProvider,
  type SourceControlAttention,
  type SourceControlHostChoice,
  type SourceControlHostDeclarations,
  type SourceControlHostState,
  type SourceControlProjectDeclarationRecord,
  sourceControlHostKey,
} from '@shared/types/source-control'
import type { SourceControlCliHosts } from './cli-host-config'
import { decideSourceControlHostProvider } from './host-provider-decision'
import { parseRemoteLocation, type RemoteLocation } from './remote-location'

export interface SourceControlRemote {
  readonly name: string
  readonly url: string
}

/** The settings slice host resolution reads. */
export interface SourceControlResolutionPreferences {
  readonly userChoices: Readonly<Record<string, SourceControlHostChoice>>
  readonly detectedHosts: Readonly<Record<string, SourceControlProviderId>>
  readonly projectDeclarations: Readonly<Record<string, SourceControlProjectDeclarationRecord>>
}

export interface SourceControlRemoteResolutionDeps {
  readonly readPrimaryRemote: (workingPath: string) => Promise<SourceControlRemote | null>
  readonly readPreferences: () => Promise<SourceControlResolutionPreferences>
  readonly readProjectDeclarations: (projectPath: string) => Promise<SourceControlHostDeclarations>
  readonly readCliHosts: () => Promise<SourceControlCliHosts>
  readonly readCredentialHelpers: (
    workingPath: string,
  ) => Promise<Readonly<Record<string, SourceControlProviderId>>>
  /** The HostName SSH would connect to for an alias, or the alias itself. */
  readonly resolveSshHostName: (alias: string) => Promise<string>
  /** Which provider's change-request refs the remote advertises, if any. */
  readonly probeRemoteRefs: (
    workingPath: string,
    remoteName: string,
  ) => Promise<SourceControlProviderId | null>
  readonly rememberDetectedHost: (host: string, provider: SourceControlProviderId) => Promise<void>
}

export type SourceControlRemoteResolution =
  | { readonly kind: 'no-remote' }
  | { readonly kind: 'unrecognised-remote'; readonly remote: SourceControlRemote }
  | {
      readonly kind: 'resolved'
      readonly remote: SourceControlRemote
      readonly repository: SourceControlRepositoryIdentity
      readonly hostState: SourceControlHostState
      readonly attention: SourceControlAttention | null
    }
  | {
      readonly kind: 'undecided'
      readonly remote: SourceControlRemote
      readonly hostState: SourceControlHostState
      readonly attention: SourceControlAttention | null
    }

export interface SourceControlRemoteResolutionInput {
  readonly workingPath: string
  /** Project root whose shared declarations and decisions apply, when known. */
  readonly projectPath: string | null
  /** Allow `git ls-remote` against the remote when offline signals are not enough. */
  readonly probeRemote: boolean
}

/** Public hosts of other forges, which OpenWaggle does not drive (ADR 0048). */
const OTHER_FORGE_HOSTS = new Set([
  'bitbucket.org',
  'dev.azure.com',
  'ssh.dev.azure.com',
  'vs-ssh.visualstudio.com',
  'codeberg.org',
  'gitea.com',
])

/** Paths only other forges use: Azure DevOps `…/_git/repo` and Bitbucket Server `scm/…`. */
function isOtherForge(location: RemoteLocation) {
  const segments = location.owner.split('/')
  return (
    OTHER_FORGE_HOSTS.has(location.host) ||
    location.host.endsWith('.visualstudio.com') ||
    segments.includes('_git') ||
    (segments[0] === 'scm' && segments.length > 1)
  )
}

/** Hostnames the providers use for SSH over port 443, mapped to their web hosts. */
const SSH_OVER_HTTPS_HOSTS: Readonly<Record<string, string>> = {
  'ssh.github.com': 'github.com',
  'altssh.gitlab.com': 'gitlab.com',
}

/**
 * The web host behind a remote. A host OpenWaggle already recognises is kept as written, so an
 * SSH config that routes github.com through ssh.github.com:443 does not move it. Otherwise an
 * SSH alias resolves to its HostName, and glab's `ssh_host` maps back to its GitLab instance.
 */
async function resolveWebLocation(
  location: RemoteLocation,
  deps: SourceControlRemoteResolutionDeps,
  cliHosts: SourceControlCliHosts,
  isRecognisedHost: (host: string) => boolean,
): Promise<RemoteLocation> {
  if (!location.sshTransport || isRecognisedHost(location.host)) return location
  const resolved = sourceControlHostKey(await deps.resolveSshHostName(location.host))
  const real = isSourceControlHostName(resolved) ? resolved : location.host
  const host = SSH_OVER_HTTPS_HOSTS[real] ?? real
  const gitlabInstance = cliHosts.gitlab.find((entry) => entry.sshHost === host)?.host
  const webHost = gitlabInstance ?? host
  return { ...location, host: webHost, webAuthority: webHost }
}

/**
 * Which declared hosts apply, judged per host: a host the user decided on keeps that decision
 * while the file still says the same, an approved host applies before the file reaches the
 * project root (an unmerged worktree branch), and only new or changed hosts are asked about.
 */
function declarationState(
  projectPath: string | null,
  declared: SourceControlHostDeclarations,
  preferences: SourceControlResolutionPreferences,
) {
  const record = projectPath ? preferences.projectDeclarations[projectPath] : undefined
  if (!projectPath) return { approved: {}, pending: null }
  const approvedHosts = record?.approved ?? {}
  const declinedHosts = record?.declined ?? {}
  const approved: Record<string, SourceControlProviderId> = {}
  for (const [host, provider] of Object.entries(approvedHosts)) {
    if (declared[host] === undefined || declared[host] === provider) approved[host] = provider
  }
  const pending: Record<string, SourceControlProviderId> = {}
  for (const [host, provider] of Object.entries(declared)) {
    if (approvedHosts[host] !== provider && declinedHosts[host] !== provider)
      pending[host] = provider
  }
  return { approved, pending: Object.keys(pending).length > 0 ? pending : null }
}

/** Sources a per-host git credential helper outranks, so the helpers are worth reading. */
const WEAKER_THAN_CREDENTIAL_HELPER = new Set(['repository-path', 'host-name', 'remote-refs'])

interface DecisionInputs {
  readonly preferences: SourceControlResolutionPreferences
  readonly declared: SourceControlHostDeclarations
  readonly cliHosts: SourceControlCliHosts
}

async function decideProvider(
  input: SourceControlRemoteResolutionInput,
  location: RemoteLocation,
  deps: SourceControlRemoteResolutionDeps,
  inputs: DecisionInputs,
) {
  const declarations = declarationState(input.projectPath, inputs.declared, inputs.preferences)
  const decide = (credentialHelpers: Readonly<Record<string, SourceControlProviderId>>) =>
    decideSourceControlHostProvider(location.host, location.owner, {
      userChoices: providerChoices(inputs.preferences.userChoices),
      approvedDeclarations: declarations.approved,
      cliHosts: inputs.cliHosts,
      credentialHelpers,
      detectedHosts: inputs.preferences.detectedHosts,
    })
  const offline = decide({})
  const decision =
    offline && !WEAKER_THAN_CREDENTIAL_HELPER.has(offline.source)
      ? offline
      : decide(await deps.readCredentialHelpers(input.workingPath))
  const pendingProvider = declarations.pending?.[location.host]
  const declarationAttention: SourceControlAttention | null =
    input.projectPath &&
    declarations.pending &&
    pendingProvider &&
    decision?.source !== 'user-choice' &&
    pendingProvider !== decision?.provider
      ? { kind: 'approve-declaration', projectPath: input.projectPath, hosts: declarations.pending }
      : null
  return { decision, declarationAttention }
}

/** The user's provider choices, without hosts they marked as neither provider. */
export function providerChoices(
  choices: Readonly<Record<string, SourceControlHostChoice>>,
): Readonly<Record<string, SourceControlProviderId>> {
  const providers: Record<string, SourceControlProviderId> = {}
  for (const [host, choice] of Object.entries(choices)) {
    if (choice !== 'unsupported') providers[host] = choice
  }
  return providers
}

function isRecognised(host: string, inputs: DecisionInputs) {
  return Boolean(
    publicSourceControlProvider(host) !== undefined ||
      inputs.preferences.userChoices[host] ||
      inputs.preferences.detectedHosts[host] ||
      inputs.declared[host] ||
      inputs.cliHosts.github.some((entry) => entry.host === host) ||
      inputs.cliHosts.gitlab.some((entry) => entry.host === host),
  )
}

/**
 * Resolve the Source control host, provider, and repository behind a working tree's primary
 * remote (ADR 0048). Offline signals decide first; `git ls-remote` runs only when allowed and
 * still needed, and its answer is remembered for the host.
 */
export async function resolveSourceControlRemote(
  input: SourceControlRemoteResolutionInput,
  deps: SourceControlRemoteResolutionDeps,
): Promise<SourceControlRemoteResolution> {
  const remote = await deps.readPrimaryRemote(input.workingPath)
  if (!remote) return { kind: 'no-remote' }
  const parsed = parseRemoteLocation(remote.url)
  if (!parsed) return { kind: 'unrecognised-remote', remote }
  const [cliHosts, preferences, declared] = await Promise.all([
    deps.readCliHosts(),
    deps.readPreferences(),
    input.projectPath ? deps.readProjectDeclarations(input.projectPath) : Promise.resolve({}),
  ])
  const inputs: DecisionInputs = { preferences, declared, cliHosts }
  const location = await resolveWebLocation(parsed, deps, cliHosts, (host) =>
    isRecognised(host, inputs),
  )
  if (preferences.userChoices[location.host] === 'unsupported') {
    return { kind: 'unrecognised-remote', remote }
  }
  const { decision, declarationAttention } = await decideProvider(input, location, deps, inputs)
  // Another forge's host or path shape outranks only guesses: a user choice, an approved
  // declaration, a public host, a CLI sign-in, or a credential helper still decides.
  if (isOtherForge(location) && (!decision || WEAKER_THAN_CREDENTIAL_HELPER.has(decision.source))) {
    return { kind: 'unrecognised-remote', remote }
  }
  let resolved = decision
  if (!resolved && !declarationAttention && input.probeRemote) {
    const probed = await deps.probeRemoteRefs(input.workingPath, remote.name)
    if (probed) {
      await deps.rememberDetectedHost(location.host, probed)
      resolved = { provider: probed, source: 'remote-refs' }
    }
  }
  if (!resolved) {
    const attention: SourceControlAttention | null =
      declarationAttention ??
      (input.probeRemote ? { kind: 'choose-provider', host: location.host } : null)
    return {
      kind: 'undecided',
      remote,
      hostState: { host: location.host, provider: null, source: null },
      attention,
    }
  }
  return {
    kind: 'resolved',
    remote,
    repository: {
      provider: resolved.provider,
      host: location.webAuthority,
      owner: location.owner,
      repository: location.repository,
    },
    hostState: { host: location.host, provider: resolved.provider, source: resolved.source },
    attention: declarationAttention,
  }
}
