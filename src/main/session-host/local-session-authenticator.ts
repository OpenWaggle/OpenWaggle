import { createHash } from 'node:crypto'
import type { LocalSessionClientHello } from '@shared/types/local-session-protocol'
import type { AuthenticatedLocalSessionCaller } from './local-session-server'
import { credentialsMatch } from './local-user-credential'

const MACHINE_IDENTITY_CHARACTERS = 20

function canonicalSet(values: readonly string[] | undefined) {
  return values ? [...new Set(values)].sort() : undefined
}

function stableTransientScope(
  scope: NonNullable<LocalSessionClientHello['transientAuthority']>['scope'],
) {
  const workspaceRoots = canonicalSet(scope.workspaceRoots)
  const exportRoots = canonicalSet(scope.exportRoots)
  const attachmentRoots = canonicalSet(scope.attachmentRoots)
  const sessionIds = canonicalSet(scope.sessionIds)
  const hiveRootSessionIds = canonicalSet(scope.hiveRootSessionIds)
  return {
    ...(workspaceRoots ? { workspaceRoots } : {}),
    ...(exportRoots ? { exportRoots } : {}),
    ...(attachmentRoots ? { attachmentRoots } : {}),
    ...(sessionIds ? { sessionIds } : {}),
    ...(hiveRootSessionIds ? { hiveRootSessionIds } : {}),
  }
}

function transientAuthorityDigest(
  authority: NonNullable<LocalSessionClientHello['transientAuthority']>,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        profileId: authority.profileId,
        profileName: authority.profileName,
        capabilities: canonicalSet(authority.capabilities),
        scope: stableTransientScope(authority.scope),
        authorizationCeiling: authority.authorizationCeiling,
      }),
    )
    .digest('hex')
    .slice(0, MACHINE_IDENTITY_CHARACTERS)
}

export interface LocalSessionNamedProfileAuthenticator {
  readonly authenticate: (input: {
    readonly profile: string
    readonly credential: string
    readonly clientKind: LocalSessionClientHello['clientKind']
    readonly clientVersion: string
  }) => Promise<AuthenticatedLocalSessionCaller>
}

function authenticateTransientMcpAuthority(
  hello: LocalSessionClientHello,
): AuthenticatedLocalSessionCaller | undefined {
  const authority = hello.transientAuthority
  if (!authority) return
  if (hello.clientKind !== 'mcp' || authority.managementEnvelope) {
    throw new Error('Transient Local Session authority is restricted to MCP clients.')
  }
  const scope = authority.scope
  if (
    scope.all ||
    ((scope.workspaceRoots?.length ?? 0) === 0 && (scope.sessionIds?.length ?? 0) === 0)
  ) {
    throw new Error('Transient MCP authority requires an explicit workspace or Session scope.')
  }
  return {
    callerId: `transient-mcp:${transientAuthorityDigest(authority)}`,
    ...(hello.workingDirectory ? { workingDirectory: hello.workingDirectory } : {}),
    profileAuthority: authority,
    baseProfileScope: scope,
  }
}

/**
 * An `mcp serve --profile` server authenticates as the named profile and sends its own grants as
 * a narrowing (#350). Only an MCP client may, and only with an explicit target scope.
 */
function assertProfileNarrowing(hello: LocalSessionClientHello) {
  const narrowing = hello.transientAuthority
  if (!narrowing) return
  if (hello.clientKind !== 'mcp' || narrowing.managementEnvelope) {
    throw new Error('Only an MCP server may narrow a named Local Session profile.')
  }
  const scope = narrowing.scope
  if (
    scope.all ||
    ((scope.workspaceRoots?.length ?? 0) === 0 && (scope.sessionIds?.length ?? 0) === 0)
  ) {
    throw new Error('A narrowed MCP profile requires an explicit workspace or Session scope.')
  }
}

/**
 * Until `refreshNamedProfileCaller` intersects the profile with the narrowing, the caller holds
 * no capability and no target, so a path that skips the refresh fails closed.
 */
function narrowingPlaceholder(
  caller: AuthenticatedLocalSessionCaller,
  narrowing: NonNullable<LocalSessionClientHello['transientAuthority']>,
): AuthenticatedLocalSessionCaller {
  const authority = caller.profileAuthority
  if (!authority) throw new Error('A narrowed MCP profile requires a named profile authority.')
  const { derivedSessionAuthorities: _, eventAdmissionSessionIds: __, ...rest } = caller
  return {
    ...rest,
    profileAuthority: { ...authority, capabilities: [], scope: {} },
    baseProfileScope: {},
    profileNarrowing: narrowing,
  }
}

export function createLocalSessionAuthenticator(input: {
  readonly localUserCredential: string
  readonly namedProfiles?: LocalSessionNamedProfileAuthenticator
}) {
  const localMachineIdentity = createHash('sha256')
    .update(input.localUserCredential)
    .digest('hex')
    .slice(0, MACHINE_IDENTITY_CHARACTERS)
  return async (hello: LocalSessionClientHello): Promise<AuthenticatedLocalSessionCaller> => {
    if (hello.profile && hello.transientAuthority) assertProfileNarrowing(hello)
    if (hello.profile) {
      if (!hello.credential || !input.namedProfiles) {
        throw new Error('Named Local Session profile authentication failed.')
      }
      const caller = await input.namedProfiles.authenticate({
        profile: hello.profile,
        credential: hello.credential,
        clientKind: hello.clientKind,
        clientVersion: hello.clientVersion,
      })
      return {
        ...(hello.transientAuthority
          ? narrowingPlaceholder(caller, hello.transientAuthority)
          : caller),
        ...(hello.workingDirectory ? { workingDirectory: hello.workingDirectory } : {}),
      }
    }
    if (!hello.credential || !credentialsMatch(input.localUserCredential, hello.credential)) {
      throw new Error('Local-user authentication failed.')
    }
    const transientCaller = authenticateTransientMcpAuthority(hello)
    if (transientCaller) return transientCaller
    return {
      callerId:
        hello.clientKind === 'gui' ? 'gui:local-user' : `local-user:${localMachineIdentity}`,
      ...(hello.workingDirectory ? { workingDirectory: hello.workingDirectory } : {}),
    }
  }
}
