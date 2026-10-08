import type { SourceControlProviderId } from './change-request'

/** Where activating a Change request row goes (Change request open destination). */
export const CHANGE_REQUEST_OPEN_DESTINATIONS = ['inspector', 'website'] as const
export type ChangeRequestOpenDestination = (typeof CHANGE_REQUEST_OPEN_DESTINATIONS)[number]
export const DEFAULT_CHANGE_REQUEST_OPEN_DESTINATION: ChangeRequestOpenDestination = 'inspector'

/** Which level supplied the effective Change request open destination. */
export type ChangeRequestOpenDestinationSource =
  | 'project-local'
  | 'user'
  | 'project-shared'
  | 'default'

export interface ChangeRequestOpenDestinationResolution {
  readonly destination: ChangeRequestOpenDestination
  readonly source: ChangeRequestOpenDestinationSource
}

/**
 * How OpenWaggle decided a Source control host's provider, in precedence order: the user's own
 * choice, an approved project declaration, then offline detection, then the remote's refs.
 */
export const SOURCE_CONTROL_PROVIDER_SOURCES = [
  'user-choice',
  'project-declaration',
  'public-host',
  'cli-sign-in',
  'git-credential-helper',
  'repository-path',
  'host-name',
  'remote-refs',
] as const
export type SourceControlProviderSource = (typeof SOURCE_CONTROL_PROVIDER_SOURCES)[number]

export const SOURCE_CONTROL_PROJECT_DECLARATION_DECISIONS = ['approved', 'declined'] as const
export type SourceControlProjectDeclarationDecision =
  (typeof SOURCE_CONTROL_PROJECT_DECLARATION_DECISIONS)[number]

/** Hosts a project's shared files declare, keyed by lowercase hostname. */
export type SourceControlHostDeclarations = Readonly<Record<string, SourceControlProviderId>>

/**
 * The user's local decisions about a project's shared host declarations, per host: each host keeps
 * the decision made for the exact provider the file declared, and a changed provider asks again.
 */
export interface SourceControlProjectDeclarationRecord {
  readonly approved: SourceControlHostDeclarations
  readonly declined: SourceControlHostDeclarations
}

/** The provider resolved for one Source control host, and how it was decided. */
export interface SourceControlHostState {
  readonly host: string
  readonly provider: SourceControlProviderId | null
  readonly source: SourceControlProviderSource | null
}

export type SourceControlCli = 'gh' | 'glab'

/**
 * Something the user must do before change requests work for a Session's remote. Offline
 * kinds come with Local VCS status; CLI and account kinds come with Remote VCS status.
 */
export type SourceControlAttention =
  | { readonly kind: 'choose-provider'; readonly host: string }
  | {
      readonly kind: 'approve-declaration'
      readonly projectPath: string
      readonly hosts: SourceControlHostDeclarations
    }
  | {
      readonly kind: 'cli-missing'
      readonly provider: SourceControlProviderId
      readonly host: string
      readonly cli: SourceControlCli
    }
  | {
      readonly kind: 'not-signed-in'
      readonly provider: SourceControlProviderId
      readonly host: string
      readonly cli: SourceControlCli
      /** A provider token variable exists in the environment, which OpenWaggle never uses. */
      readonly environmentTokenIgnored: boolean
      /** The names of those variables, for example `GITHUB_TOKEN`. */
      readonly ignoredTokenVariables: readonly string[]
    }
  | {
      readonly kind: 'no-account-access'
      readonly provider: SourceControlProviderId
      readonly host: string
      readonly cli: SourceControlCli
      /** `owner/repository` that none of the signed-in Provider accounts can see. */
      readonly repository: string
      readonly accounts: readonly string[]
    }

export type SourceControlAttentionKind = SourceControlAttention['kind']

/** One Provider account a CLI holds for a host. */
export interface SourceControlProviderAccount {
  readonly login: string
  readonly active: boolean
}

/** The user's choice for a host: a provider, or that it is neither GitHub nor GitLab. */
export type SourceControlHostChoice = SourceControlProviderId | 'unsupported'

/** One row of the Settings → Connections → Source control hosts list. */
export interface SourceControlHostEntry {
  readonly host: string
  readonly provider: SourceControlProviderId | null
  /** The user said this host is neither GitHub nor GitLab, so OpenWaggle stops asking. */
  readonly unsupported: boolean
  readonly source: SourceControlProviderSource | null
  readonly cli: SourceControlCli | null
  readonly cliInstalled: boolean
  readonly accounts: readonly SourceControlProviderAccount[]
}

export interface SourceControlHostsOverview {
  readonly hosts: readonly SourceControlHostEntry[]
  readonly cliInstalled: Readonly<Record<SourceControlCli, boolean>>
}

export const PUBLIC_SOURCE_CONTROL_HOSTS: Readonly<Record<string, SourceControlProviderId>> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
}

/** github.com, gitlab.com, and GitHub Enterprise Cloud data-residency hosts (`*.ghe.com`). */
export function publicSourceControlProvider(host: string): SourceControlProviderId | undefined {
  const key = sourceControlHostKey(host)
  return PUBLIC_SOURCE_CONTROL_HOSTS[key] ?? (key.endsWith('.ghe.com') ? 'github' : undefined)
}

export function sourceControlCliForProvider(provider: SourceControlProviderId): SourceControlCli {
  return provider === 'github' ? 'gh' : 'glab'
}

/**
 * A lowercase hostname or SSH alias (letters, digits, `-`, `_`, dots) with an optional port: the
 * only host text ever put in a command. IPv6 literals are not supported.
 */
const SOURCE_CONTROL_HOST_PATTERN =
  /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*(?::\d{1,5})?$/u

export function isSourceControlHostName(host: string) {
  return SOURCE_CONTROL_HOST_PATTERN.test(host)
}

/** Token variables each CLI prefers over its stored sign-in; OpenWaggle never uses them. */
export const SOURCE_CONTROL_TOKEN_VARIABLES = {
  github: ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_ENTERPRISE_TOKEN'],
  gitlab: ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'GITLAB_PRIVATE_TOKEN'],
} as const satisfies Record<SourceControlProviderId, readonly string[]>

/** The shell a sign-in command is typed into: POSIX shells, or PowerShell on Windows. */
export type SourceControlCommandShell = 'posix' | 'powershell'

/**
 * The CLI login command for a host. A host that is not a plain hostname is never interpolated
 * into a shell command; the CLI then asks for the host. With a `shell`, the command first clears
 * the provider's token variables (for that one command in POSIX shells, for the rest of that
 * terminal in PowerShell), because `gh auth login` refuses to run while `GH_TOKEN` is set.
 */
export function sourceControlSignInCommand(
  provider: SourceControlProviderId,
  host: string,
  shell: SourceControlCommandShell | null = null,
) {
  const cli = sourceControlCliForProvider(provider)
  const key = sourceControlHostKey(host)
  const login = isSourceControlHostName(key)
    ? `${cli} auth login --hostname ${key}`
    : `${cli} auth login`
  const variables = SOURCE_CONTROL_TOKEN_VARIABLES[provider]
  if (shell === 'posix') return `env ${variables.map((name) => `-u ${name}`).join(' ')} ${login}`
  if (shell === 'powershell') {
    const items = variables.map((name) => `Env:${name}`).join(',')
    return `Remove-Item ${items} -ErrorAction SilentlyContinue; ${login}`
  }
  return login
}

/** Canonical lowercase key of a host name used by every per-host setting. */
export function sourceControlHostKey(host: string) {
  return host.trim().toLowerCase()
}

/**
 * `host/owner/repository` with the owner and repository as written. GitLab paths are
 * case-sensitive, so a remembered repository is stored this way and only looked up by key.
 */
export function sourceControlRepositoryReference(repository: {
  readonly host: string
  readonly owner: string
  readonly repository: string
}) {
  return `${sourceControlHostKey(repository.host)}/${repository.owner}/${repository.repository}`
}

/** Canonical key of a repository used by every per-repository setting. */
export function sourceControlRepositoryKey(repository: {
  readonly host: string
  readonly owner: string
  readonly repository: string
}) {
  return `${sourceControlHostKey(repository.host)}/${repository.owner}/${repository.repository}`.toLowerCase()
}

/** Where an open-destination override is stored (Change request open destination). */
export type ChangeRequestOpenDestinationScope = 'user' | 'project-local' | 'project-shared'

/**
 * One source-control configuration change, shared by Settings, the Session Summary, and the
 * agent's `source_control` tool so every surface validates and stores it the same way.
 */
export type SourceControlConfigureRequest =
  | {
      /**
       * The user's own provider for a host, or `unsupported` for neither; null forgets the choice
       * and what was detected.
       */
      readonly kind: 'set-host-provider'
      readonly host: string
      readonly provider: SourceControlHostChoice | null
    }
  | {
      /** A project's shared host declaration, written to its settings file and approved. */
      readonly kind: 'declare-project-host'
      readonly projectPath: string
      /** Checkout whose settings file is written; defaults to the project root. */
      readonly workingPath?: string
      readonly host: string
      readonly provider: SourceControlProviderId | null
    }
  | {
      readonly kind: 'decide-project-declaration'
      readonly projectPath: string
      readonly decision: SourceControlProjectDeclarationDecision
      readonly hosts: SourceControlHostDeclarations
    }
  | {
      readonly kind: 'set-open-destination'
      readonly scope: ChangeRequestOpenDestinationScope
      /** Required for the project scopes. */
      readonly projectPath?: string
      /** Checkout whose settings file a shared destination is written to; defaults to the project. */
      readonly workingPath?: string
      /** null clears the override at that scope. */
      readonly destination: ChangeRequestOpenDestination | null
    }
  | {
      /** The Provider account to use for one repository; null returns to automatic. */
      readonly kind: 'set-repository-account'
      readonly repository: string
      readonly login: string | null
    }

export type SourceControlConfigureResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** Most entries any source-control Settings record keeps; the oldest are dropped past it. */
export const SOURCE_CONTROL_SETTINGS_RECORD_LIMIT = 500

/**
 * An atomic change to source-control Settings: each record entry is set, or removed with null,
 * against the latest stored value. Processes never send whole records, so concurrent writers
 * cannot drop each other's entries (ADR 0048).
 */
export interface SourceControlSettingsPatch {
  readonly changeRequestOpenDestination?: ChangeRequestOpenDestination | null
  readonly changeRequestOpenDestinationByProject?: Readonly<
    Record<string, ChangeRequestOpenDestination | null>
  >
  readonly sourceControlHostProviders?: Readonly<Record<string, SourceControlHostChoice | null>>
  readonly sourceControlDetectedHostProviders?: Readonly<
    Record<string, SourceControlProviderId | null>
  >
  readonly sourceControlRepositoryAccounts?: Readonly<Record<string, string | null>>
  readonly sourceControlChangeRequestRepositories?: Readonly<Record<string, string | null>>
  readonly sourceControlProjectDeclarations?: Readonly<
    Record<string, SourceControlProjectDeclarationRecord | null>
  >
}
