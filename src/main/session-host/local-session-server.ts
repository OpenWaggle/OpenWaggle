import net, { type Server, type Socket } from 'node:net'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionClientHello } from '@shared/types/local-session-protocol'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import type { SessionHostEventHub } from '../application/session-host-event-hub'
import type { SessionHostLiveness } from '../application/session-host-liveness'
import { LocalSessionConnection } from './local-session-connection'
import {
  prepareLocalSessionEndpoint,
  removeLocalSessionEndpoint,
  secureLocalSessionEndpoint,
} from './local-session-endpoint'
import { installLocalSessionProfileInvalidator } from './local-session-profile-invalidation'
import {
  DEFAULT_MAX_CONNECTIONS,
  LocalSessionAuthenticationBudget,
  LocalSessionInboundByteBudget,
} from './local-session-resource-policy'

export type AuthenticatedLocalSessionCaller = LocalSessionCallerIdentity

export interface LocalSessionServerDependencies {
  readonly hostInstanceId: string
  readonly eventHub: SessionHostEventHub
  readonly liveness: SessionHostLiveness
  readonly authenticate: (
    hello: LocalSessionClientHello,
    socket: Socket,
  ) => Promise<AuthenticatedLocalSessionCaller>
  readonly dispatch: (input: {
    readonly caller: AuthenticatedLocalSessionCaller
    readonly negotiatedRevision: number
    readonly eventCursor: SessionHostEventCursor
    readonly payload: unknown
    readonly signal: AbortSignal
  }) => Promise<unknown>
  readonly authorizeEvent?: (
    caller: AuthenticatedLocalSessionCaller,
    event: SessionHostEventEnvelope,
  ) => Promise<boolean>
  readonly snapshotActiveRuns?: () => readonly BackgroundRunSnapshot[]
  readonly authorizeActiveRun?: (
    caller: AuthenticatedLocalSessionCaller,
    snapshot: BackgroundRunSnapshot,
  ) => Promise<boolean>
  readonly handshakeTimeoutMs?: number
  readonly maxConnections?: number
  readonly maxSubscriptionsPerConnection?: number
  readonly maxSubscriptionsGlobal?: number
  readonly maxPendingInboundBytesGlobal?: number
  readonly maxConcurrentAuthentications?: number
  readonly maxFailedAuthenticationAttempts?: number
  readonly maxFailedAuthenticationAttemptsGlobal?: number
  readonly authenticationFailureWindowMs?: number
  readonly authenticationCooldownMs?: number
  readonly disconnectProfile?: (profileId: string) => void
  readonly describeUpgradeBlockers?: () => Promise<{
    readonly blockingRuns: readonly { readonly sessionId: string; readonly runId: string }[]
    readonly blockingOperations: readonly {
      readonly operationId: string
      readonly operation: string
      readonly targetScope: string
    }[]
  }>
  readonly requestUpgradeDrain?: () => void
}

export interface LocalSessionServerHandle {
  readonly endpoint: string
  readonly server: Server
  readonly close: (removeEndpointAfterClose?: boolean) => Promise<void>
  readonly removeEndpoint: () => Promise<void>
}

function listen(server: Server, endpoint: string) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export async function listenLocalSessionServer(
  endpoint: string,
  dependencies: LocalSessionServerDependencies,
): Promise<LocalSessionServerHandle> {
  await prepareLocalSessionEndpoint(endpoint)
  const connections = new Set<LocalSessionConnection>()
  const inboundBudget = new LocalSessionInboundByteBudget(dependencies.maxPendingInboundBytesGlobal)
  const authenticationBudget = new LocalSessionAuthenticationBudget({
    ...(dependencies.maxConcurrentAuthentications !== undefined
      ? { maxConcurrent: dependencies.maxConcurrentAuthentications }
      : {}),
    ...(dependencies.maxFailedAuthenticationAttempts !== undefined
      ? { maxFailedAttempts: dependencies.maxFailedAuthenticationAttempts }
      : {}),
    ...(dependencies.maxFailedAuthenticationAttemptsGlobal !== undefined
      ? { maxFailedAttemptsGlobal: dependencies.maxFailedAuthenticationAttemptsGlobal }
      : {}),
    ...(dependencies.authenticationFailureWindowMs !== undefined
      ? { failureWindowMs: dependencies.authenticationFailureWindowMs }
      : {}),
    ...(dependencies.authenticationCooldownMs !== undefined
      ? { cooldownMs: dependencies.authenticationCooldownMs }
      : {}),
  })
  const invalidateProfile = (profileId: string) => {
    for (const connection of connections) connection.disconnectRevokedProfile(profileId)
  }
  const releaseProfileInvalidator = installLocalSessionProfileInvalidator(invalidateProfile)
  const serverDependencies: LocalSessionServerDependencies = {
    ...dependencies,
    disconnectProfile: invalidateProfile,
  }
  const server = net.createServer((socket) => {
    if (connections.size >= (dependencies.maxConnections ?? DEFAULT_MAX_CONNECTIONS)) {
      socket.destroy()
      return
    }
    const connection = new LocalSessionConnection(
      socket,
      serverDependencies,
      inboundBudget,
      authenticationBudget,
    )
    connections.add(connection)
    socket.once('close', () => connections.delete(connection))
    connection.start()
  })
  await listen(server, endpoint)
  await secureLocalSessionEndpoint(endpoint)
  return {
    endpoint,
    server,
    close: async (removeEndpointAfterClose = true) => {
      releaseProfileInvalidator()
      const closing = close(server)
      for (const connection of connections) connection.shutdown()
      await closing
      if (removeEndpointAfterClose) await removeLocalSessionEndpoint(endpoint)
    },
    removeEndpoint: () => removeLocalSessionEndpoint(endpoint),
  }
}
