import { matchBy } from '@diegogbrisa/ts-match'
import { formatErrorMessage } from '@shared/utils/node-error'
import { app } from 'electron'
import { CliError } from './cli-error'
import { env } from './env'
import { hasFlag, option, type ParsedArguments, readSecretFromStdin } from './mcp-cli-arguments'
import type { executeLocalSessionCommand } from './session-host/local-session-client'
import { LocalSessionClientProtocolError } from './session-host/local-session-client-protocol-error'
import { ensureLocalSessionHost } from './session-host/local-session-host-launcher'
import {
  prepareLocalSessionHostPaths,
  refreshLocalSessionHostEndpoint,
  resolveLocalSessionHostPaths,
} from './session-host/local-session-paths'
import {
  readProfileCredentialFile,
  readStoredProfileCredential,
} from './session-host/profile-credential-destination'

export type LocalSessionCliClientInput = Omit<
  Parameters<typeof executeLocalSessionCommand>[0],
  'payload'
>

function hasProfileCredentialSource(arguments_: ParsedArguments) {
  return (
    arguments_.options.has('credential-stdin') ||
    arguments_.options.has('profile-credential-file') ||
    Boolean(env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE)
  )
}

/** The refusal an agent Run gets when it reaches for the desktop user's authority. */
export const CLI_AGENT_OWNER_REFUSAL =
  'OpenWaggle agents must use their native Hive tool or an explicit named CLI profile.'

/**
 * The bundled shell marks agent Runs with `OPENWAGGLE_AGENT_RUN=1`. Such a Run must not reach the
 * desktop user's own authority through the CLI or `mcp serve --owner`; it uses its native Hive
 * tool or a named access profile. A guardrail against accidents, not a security boundary, so it
 * is an `authorization` refusal (exit 4).
 */
export function assertCliAgentMayUseOwnerAuthority(refusal: string = CLI_AGENT_OWNER_REFUSAL) {
  if (env.OPENWAGGLE_AGENT_RUN !== '1') return
  throw new CliError('authorization', refusal)
}

export interface LocalSessionCliClientOptions {
  readonly supportedRevisions?: readonly number[]
  /** What an agent Run is told when it runs this command without a named profile. */
  readonly agentRefusal?: string
}

type CredentialSource =
  | { readonly kind: 'stdin' }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'store' }

function describeCredentialSource(source: CredentialSource) {
  return matchBy(source, 'kind')
    .with('stdin', () => 'standard input')
    .with('file', (file) => JSON.stringify(file.path))
    .with('store', () => 'the credential store')
    .exhaustive()
}

async function readProfileCredential(profile: string, source: CredentialSource, stateRoot: string) {
  try {
    return await matchBy(source, 'kind')
      .with('stdin', () => readSecretFromStdin())
      .with('file', (file) => readProfileCredentialFile(file.path))
      .with('store', () => readStoredProfileCredential({ stateRoot, profileName: profile }))
      .exhaustive()
  } catch (cause) {
    if (cause instanceof CliError) throw cause
    throw new CliError(
      'authentication',
      `Could not read the credential for access profile ${JSON.stringify(profile)} from ${describeCredentialSource(source)}: ${formatErrorMessage(cause)}`,
      { cause },
    )
  }
}

const REFUSED_CREDENTIAL_CODES = new Set([
  'authentication_failed',
  'credential_rejected',
  'profile_revoked',
  'profile_not_found',
])

/**
 * A credential the Host refuses says which one it was, so a stale credential-store copy left
 * after `rotate --credential-file` is not just "authentication failed" (#351).
 */
function refusedCredentialError(input: LocalSessionCliClientInput, cause: unknown) {
  if (
    !input.profile ||
    !(cause instanceof LocalSessionClientProtocolError) ||
    !REFUSED_CREDENTIAL_CODES.has(cause.code)
  ) {
    return cause
  }
  return new CliError(
    'authentication',
    `The Session Host refused the credential for access profile ${JSON.stringify(input.profile)} (${cause.message}). The profile may be unknown or revoked, or its credential may have been rotated: pass the current one with --profile-credential-file, or rotate it with openwaggle access profiles rotate.`,
    { cause },
  )
}

/** Resolve CLI identity and Host paths without starting or contacting the Session Host. */
export async function prepareLocalSessionCliClientInput(
  arguments_: ParsedArguments,
  options: LocalSessionCliClientOptions = {},
): Promise<LocalSessionCliClientInput> {
  const profile = option(arguments_, 'profile') ?? env.OPENWAGGLE_PROFILE
  const credentialFile =
    option(arguments_, 'profile-credential-file') ?? env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE
  if (!profile && hasProfileCredentialSource(arguments_)) {
    throw new CliError('usage', 'Profile credentials require --profile or OPENWAGGLE_PROFILE.')
  }
  if (!profile) assertCliAgentMayUseOwnerAuthority(options.agentRefusal)
  const paths = await prepareLocalSessionHostPaths(
    resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') }),
  )
  const profileCredential = profile
    ? await readProfileCredential(
        profile,
        hasFlag(arguments_, 'credential-stdin')
          ? { kind: 'stdin' }
          : credentialFile
            ? { kind: 'file', path: credentialFile }
            : { kind: 'store' },
        paths.stateRoot,
      )
    : undefined
  return {
    paths,
    clientKind: 'cli' as const,
    clientVersion: app.getVersion(),
    workingDirectory: process.cwd(),
    ...(options.supportedRevisions ? { supportedRevisions: options.supportedRevisions } : {}),
    ...(profile ? { profile } : {}),
    ...(profileCredential ? { profileCredential } : {}),
  }
}

export async function createLocalSessionCliClientInput(
  arguments_: ParsedArguments,
  options: LocalSessionCliClientOptions = {},
): Promise<LocalSessionCliClientInput> {
  const input = await prepareLocalSessionCliClientInput(arguments_, options)
  try {
    await ensureLocalSessionHost(input)
  } catch (cause) {
    throw refusedCredentialError(input, cause)
  }
  return { ...input, paths: await refreshLocalSessionHostEndpoint(input.paths) }
}
