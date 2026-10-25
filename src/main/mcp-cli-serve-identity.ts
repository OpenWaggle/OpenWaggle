import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH } from '@shared/types/local-session-profile'
import { formatErrorMessage } from '@shared/utils/node-error'
import { sessionIdFromReference } from '@shared/utils/session-link'
import { CliError } from './cli-error'
import { env } from './env'
import { assertCliAgentMayUseOwnerAuthority } from './local-session-cli-client'
import {
  hasFlag,
  option,
  type ParsedArguments,
  serveAuthorizationCeiling,
} from './mcp-cli-arguments'
import type { OpenWaggleMcpServeIdentity } from './openwaggle-mcp-server-policy'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './session-host/local-session-paths'
import {
  readProfileCredentialFile,
  readStoredProfileCredential,
} from './session-host/profile-credential-destination'

/** The owner-mode label that names the transient caller; never an access profile. */
export const OWNER_SERVE_LABEL = { stdio: 'local-stdio', http: 'local-http' } as const

export type ParsedServeIdentity =
  | {
      readonly kind: 'owner'
      readonly label: string
      readonly authorizationCeiling: AgentAuthorizationMode
    }
  | { readonly kind: 'profile'; readonly profile: string; readonly credentialFile?: string }

/**
 * `--profile <name>` serves as a named access profile and `--owner` as the local desktop user,
 * narrowed by `--grant` and the scope flags (#350). One of them is required, so no server holds
 * the owner's authority by accident, and an OpenWaggle agent cannot pick `--owner`.
 */
export function parseServeIdentity(arguments_: ParsedArguments, stdio: boolean) {
  const profile = option(arguments_, 'profile')
  const owner = hasFlag(arguments_, 'owner')
  if (owner === (profile !== undefined)) {
    throw new Error(
      'Server mode requires exactly one of --profile <name> (serve as that access profile) or --owner (serve your own authority, narrowed by --grant and the scope flags).',
    )
  }
  const credentialFile =
    option(arguments_, 'profile-credential-file') ?? env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE
  if (profile === undefined && option(arguments_, 'profile-credential-file') !== undefined) {
    throw new Error('--profile-credential-file requires --profile <name>.')
  }
  if (profile !== undefined && option(arguments_, 'authorization-ceiling') !== undefined) {
    throw new Error(
      '--authorization-ceiling applies only with --owner. A profile server keeps the access profile ceiling; change it with openwaggle access profiles.',
    )
  }
  if (
    profile !== undefined &&
    (profile.length === 0 || profile.length > LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH)
  ) {
    throw new Error(
      `--profile must name an access profile of 1-${LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH} characters.`,
    )
  }
  const identity: ParsedServeIdentity =
    profile === undefined
      ? {
          kind: 'owner',
          label: stdio ? OWNER_SERVE_LABEL.stdio : OWNER_SERVE_LABEL.http,
          authorizationCeiling: serveAuthorizationCeiling(arguments_),
        }
      : { kind: 'profile', profile, ...(credentialFile ? { credentialFile } : {}) }
  if (identity.kind === 'owner') {
    assertCliAgentMayUseOwnerAuthority(
      'OpenWaggle agents cannot use --owner: use the native Hive tool or --profile <name>.',
    )
  }
  return { identity, originSessionId: parseOriginSession(arguments_) }
}

function parseOriginSession(arguments_: ParsedArguments) {
  const originReference = option(arguments_, 'origin-session')?.trim()
  const originSessionId = originReference
    ? sessionIdFromReference(originReference, '--origin-session')
    : undefined
  if (originSessionId && !/^[A-Za-z0-9._:-]{1,200}$/.test(originSessionId)) {
    throw new Error(
      'Origin session must use 1-200 letters, numbers, dots, underscores, colons, or dashes.',
    )
  }
  return originSessionId
}

/** Reads the profile's credential: `--profile-credential-file`, else the credential store. */
export async function resolveServeIdentity(
  identity: ParsedServeIdentity,
  userDataRoot: string,
): Promise<OpenWaggleMcpServeIdentity> {
  if (identity.kind === 'owner') return identity
  const credentialFile = identity.credentialFile
  const credential = credentialFile
    ? await readProfileCredentialFile(credentialFile).catch((cause: unknown) => {
        throw new CliError(
          'authentication',
          `Could not read the credential for access profile ${JSON.stringify(identity.profile)} from ${JSON.stringify(credentialFile)}: ${formatErrorMessage(cause)}`,
          { cause },
        )
      })
    : await readStoredProfileCredential({
        stateRoot: (
          await prepareLocalSessionHostPaths(resolveLocalSessionHostPaths({ userDataRoot }))
        ).stateRoot,
        profileName: identity.profile,
      })
  return { kind: 'profile', profile: identity.profile, credential }
}
