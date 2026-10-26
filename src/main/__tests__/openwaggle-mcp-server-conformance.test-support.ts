import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { refreshNamedProfileCaller } from '../application/local-session-derived-authority'
import { authenticateLocalSessionProfile } from '../application/local-session-profile-authentication'
import { serveDualEraMcpStdio } from '../mcp-server-stdio'
import { createOpenWaggleMcpServer } from '../openwaggle-mcp-server'
import { LocalSessionCredentialVerifier } from '../ports/local-session-credential-verifier'
import {
  type LocalSessionProfileAuthenticationRecord,
  LocalSessionProfileRepository,
} from '../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { createLocalSessionAuthenticator } from '../session-host/local-session-authenticator'
import { startLocalSessionHost } from '../session-host/local-session-host-runtime'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from '../session-host/local-session-paths'
import { ensureLocalUserCredential } from '../session-host/local-user-credential'
import { generateProfileCredential } from '../session-host/profile-credential'
import {
  queryResult,
  type StoredSession,
  sessionMatches,
} from './openwaggle-mcp-server-conformance-results.test-support'

export type ServeOptions = Parameters<typeof createOpenWaggleMcpServer>[0]
type ProfileRecord = LocalSessionProfileAuthenticationRecord

export const ACTIVE_CREDENTIAL = generateProfileCredential()
export const REVOKED_CREDENTIAL = generateProfileCredential()

/**
 * A Local Session Host with OpenWaggle's real authenticator, named-profile authentication, and
 * caller refresh (narrowing included) over in-memory repositories, and a `list` dispatcher that
 * filters by the caller authority the Host computed. Two projects, one Session each; an active
 * profile scoped to repo A and a revoked catalog-wide profile.
 */
export function createMcpConformanceHost() {
  let temporaryRoot = ''
  let repoA = ''
  let repoB = ''
  let sessions: readonly StoredSession[] = []
  let profiles: Map<string, ProfileRecord> = new Map()
  let dispatchedCallers: LocalSessionCallerIdentity[] = []
  let stopHost: (() => Promise<void>) | null = null
  const clients: Client[] = []
  const handles: { close(): Promise<void> }[] = []

  function repositories() {
    return Layer.mergeAll(
      Layer.succeed(LocalSessionCredentialVerifier, {
        verify: ({ credential, verifier }) => Effect.succeed(credential === verifier),
      }),
      Layer.succeed(LocalSessionProfileRepository, {
        list: () => Effect.succeed([]),
        findForAuthentication: (name) => Effect.succeed(profiles.get(name) ?? null),
        findById: (id) =>
          Effect.succeed([...profiles.values()].find((profile) => profile.id === id) ?? null),
        recordAuthentication: () => Effect.void,
        executeManagement: () => Effect.die('Profile management is not used here.'),
      }),
      Layer.succeed(SessionAuthorizationTargetRepository, {
        listAuthorizedSessionIds: (scope) =>
          Effect.succeed(
            sessions.filter((session) => sessionMatches(scope, session)).map((s) => s.id),
          ),
        resolveWorkspaceProjectPaths: (roots) =>
          Effect.succeed([
            ...new Set(
              sessions
                .map((session) => session.projectPath)
                .filter((projectPath) =>
                  roots.some(
                    (root) => projectPath === root || projectPath.startsWith(`${root}${path.sep}`),
                  ),
                ),
            ),
          ]),
        listLiveDerivedAuthorities: () => Effect.succeed([]),
        runInputWidensReach: () => Effect.succeed(false),
        resolve: () => Effect.die('not used'),
        resolveDelegation: () => Effect.die('not used'),
      }),
    )
  }

  async function start() {
    temporaryRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mcp-conformance-')),
    )
    repoA = path.join(temporaryRoot, 'repo-a')
    repoB = path.join(temporaryRoot, 'repo-b')
    await fs.mkdir(repoA)
    await fs.mkdir(repoB)
    sessions = [
      { id: 'session-a', projectPath: repoA },
      { id: 'session-b', projectPath: repoB },
    ]
    profiles = new Map([
      [
        'repo-a-reviewer',
        {
          id: 'profile-a',
          name: 'repo-a-reviewer',
          credentialVerifier: ACTIVE_CREDENTIAL,
          capabilities: ['sessions:discover', 'sessions:read'],
          scope: { projectPaths: [repoA] },
          authorizationCeiling: 'ask-for-approval',
          revokedAt: null,
        },
      ],
      [
        'revoked-reviewer',
        {
          id: 'profile-revoked',
          name: 'revoked-reviewer',
          credentialVerifier: REVOKED_CREDENTIAL,
          capabilities: ['sessions:discover'],
          scope: { all: true },
          authorizationCeiling: 'ask-for-approval',
          revokedAt: 1,
        },
      ],
    ])
    dispatchedCallers = []
    const paths = await prepareLocalSessionHostPaths(
      resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot }),
    )
    const layer = repositories()
    const authenticateCaller = createLocalSessionAuthenticator({
      localUserCredential: await ensureLocalUserCredential(paths.credentialPath),
      namedProfiles: {
        authenticate: (input) =>
          Effect.runPromise(
            authenticateLocalSessionProfile({ ...input, now: Date.now() }).pipe(
              Effect.provide(layer),
            ),
          ),
      },
    })
    const refresh = (caller: LocalSessionCallerIdentity) =>
      Effect.runPromise(refreshNamedProfileCaller(caller).pipe(Effect.provide(layer)))
    const runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: async (hello) => refresh(await authenticateCaller(hello)),
      refreshCaller: refresh,
      dispatch: async ({ caller, payload }) => {
        dispatchedCallers.push(caller)
        return queryResult(sessions, payload, caller)
      },
    })
    stopHost = async () => {
      await runtime.stop()
      const endpointDirectory = paths.endpointDirectory
      if (endpointDirectory && endpointDirectory !== paths.stateRoot) {
        await fs.rm(endpointDirectory, { recursive: true, force: true })
      }
    }
  }

  async function stop() {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    await Promise.all(handles.splice(0).map((handle) => handle.close()))
    await stopHost?.()
    stopHost = null
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  }

  function serveOptions(overrides: Partial<ServeOptions> = {}): ServeOptions {
    return {
      transport: 'stdio',
      grants: new Set<SessionCapability>(['sessions:discover']),
      workspaceRoots: [repoA, repoB],
      sessionIds: new Set(),
      identity: { kind: 'owner', label: 'local-stdio', authorizationCeiling: 'ask-for-approval' },
      userDataRoot: temporaryRoot,
      version: 'conformance',
      ...overrides,
    }
  }

  async function connect(options: ServeOptions, versions: readonly string[] = ['2025-11-25']) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    handles.push(
      serveDualEraMcpStdio(() => createOpenWaggleMcpServer(options), {
        transport: serverTransport,
      }),
    )
    const client = new Client(
      { name: 'openwaggle-conformance', version: '1.0.0' },
      {
        capabilities: {},
        supportedProtocolVersions: [...versions],
        versionNegotiation: {
          mode: versions[0] === '2026-07-28' ? { pin: versions[0] } : 'legacy',
        },
      },
    )
    clients.push(client)
    await client.connect(clientTransport)
    return client
  }

  function profileIdentity(profile: string, credential: string) {
    return { kind: 'profile' as const, profile, credential }
  }

  function revoke(name: string) {
    const profile = profiles.get(name)
    if (!profile) throw new Error(`Missing profile ${name}.`)
    profiles.set(name, { ...profile, revokedAt: Date.now() })
  }

  return {
    start,
    stop,
    serveOptions,
    connect,
    profileIdentity,
    revoke,
    repos: () => ({ repoA, repoB }),
    dispatchedCallers: () => dispatchedCallers,
    clearDispatchedCallers: () => {
      dispatchedCallers = []
    },
  }
}
