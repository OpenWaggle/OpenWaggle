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
  isWindowsPipe,
  prepareLocalSessionEndpoint,
  removeLocalSessionEndpoint,
  secureLocalSessionEndpoint,
} from './local-session-endpoint'
import { LocalSessionOutboundByteBudget } from './local-session-outbound-budget'
import type { LocalSessionSocketFrameWriter } from './local-session-outbound-writer'
import {
  installLocalSessionProfileAdmissionFencer,
  installLocalSessionProfileAdmissionRefresher,
  installLocalSessionProfileInvalidator,
} from './local-session-profile-invalidation'
import {
  DEFAULT_MAX_CONNECTIONS,
  LocalSessionAuthenticationBudget,
  LocalSessionInboundByteBudget,
  LocalSessionSubscriptionBudget,
} from './local-session-resource-policy'
import type { LocalSessionServerAuthenticator } from './local-session-server-authentication'

export type AuthenticatedLocalSessionCaller = LocalSessionCallerIdentity

export interface LocalSessionServerDependencies {
  readonly hostInstanceId: string
  readonly authenticateServer?: LocalSessionServerAuthenticator
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
    readonly releaseAdmissionReader: () => void
  }) => Promise<unknown>
  readonly authorizeEvent?: (
    caller: AuthenticatedLocalSessionCaller,
    event: SessionHostEventEnvelope,
  ) => Promise<boolean>
  readonly refreshCaller?: (
    caller: AuthenticatedLocalSessionCaller,
  ) => Promise<AuthenticatedLocalSessionCaller>
  readonly snapshotActiveRuns?: () => readonly BackgroundRunSnapshot[]
  readonly authorizeActiveRun?: (
    caller: AuthenticatedLocalSessionCaller,
    snapshot: BackgroundRunSnapshot,
  ) => Promise<boolean>
  readonly handshakeTimeoutMs?: number
  readonly maxConnections?: number
  readonly maxSubscriptionsPerConnection?: number
  readonly maxSubscriptionsGlobal?: number
  readonly subscriptionBudget?: LocalSessionSubscriptionBudget
  readonly maxPendingInboundBytesGlobal?: number
  readonly maxPendingOutboundBytesGlobal?: number
  readonly maxPendingOutboundFramesPerConnection?: number
  readonly profileAdmissionDrainTimeoutMs?: number
  readonly profileInvalidationCloseTimeoutMs?: number
  readonly writeFrame?: LocalSessionSocketFrameWriter
  readonly maxConcurrentAuthentications?: number
  readonly maxFailedAuthenticationAttempts?: number
  readonly maxFailedAuthenticationAttemptsGlobal?: number
  readonly authenticationFailureWindowMs?: number
  readonly authenticationCooldownMs?: number
  readonly secureEndpoint?: typeof secureLocalSessionEndpoint
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
  readonly outboundByteUsage: () => {
    readonly pendingBytes: number
    readonly peakBytes: number
    readonly maxBytes: number
  }
}

function listen(server: Server, endpoint: string) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(
      {
        path: endpoint,
        exclusive: true,
        readableAll: false,
        writableAll: false,
      },
      () => {
        server.off('error', reject)
        resolve()
      },
    )
  })
}

function nextEventLoopTurn() {
  return new Promise<void>((resolve) => setImmediate(resolve))
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
  const outboundBudget = new LocalSessionOutboundByteBudget(
    dependencies.maxPendingOutboundBytesGlobal,
  )
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
  const subscriptionBudget = new LocalSessionSubscriptionBudget(dependencies.maxSubscriptionsGlobal)
  const invalidateProfile = (profileId: string) => {
    for (const connection of connections) connection.disconnectRevokedProfile(profileId)
  }
  const releaseProfileInvalidator = installLocalSessionProfileInvalidator(invalidateProfile)
  const releaseProfileAdmissionRefresher = installLocalSessionProfileAdmissionRefresher(
    async (profileId, options) => {
      await Promise.all(
        [...connections].map((connection) =>
          connection.refreshProfileAdmission(profileId, options),
        ),
      )
    },
  )
  const releaseProfileAdmissionFencer = installLocalSessionProfileAdmissionFencer(
    async (profileName) => {
      await Promise.all(
        [...connections].map((connection) => connection.fenceProfileAdmission(profileName)),
      )
    },
  )
  const serverDependencies: LocalSessionServerDependencies = {
    ...dependencies,
    disconnectProfile: invalidateProfile,
    subscriptionBudget,
  }
  const quarantinedSockets = new Set<Socket>()
  let admissionOpen = !isWindowsPipe(endpoint)
  const server = net.createServer((socket) => {
    if (!admissionOpen) {
      quarantinedSockets.add(socket)
      socket.once('close', () => quarantinedSockets.delete(socket))
      socket.destroy()
      return
    }
    if (connections.size >= (dependencies.maxConnections ?? DEFAULT_MAX_CONNECTIONS)) {
      socket.destroy()
      return
    }
    const connection = new LocalSessionConnection(
      socket,
      serverDependencies,
      inboundBudget,
      authenticationBudget,
      outboundBudget,
    )
    connections.add(connection)
    socket.once('close', () => connections.delete(connection))
    connection.start()
  })
  try {
    await listen(server, endpoint)
    await (dependencies.secureEndpoint ?? secureLocalSessionEndpoint)(endpoint)
    if (!admissionOpen) {
      for (const socket of quarantinedSockets) socket.destroy()
      await nextEventLoopTurn()
      await nextEventLoopTurn()
      for (const socket of quarantinedSockets) socket.destroy()
      admissionOpen = true
    }
  } catch (error) {
    releaseProfileInvalidator()
    releaseProfileAdmissionRefresher()
    releaseProfileAdmissionFencer()
    for (const socket of quarantinedSockets) socket.destroy()
    await close(server).catch(() => undefined)
    throw error
  }
  return {
    endpoint,
    server,
    close: async (removeEndpointAfterClose = true) => {
      releaseProfileInvalidator()
      releaseProfileAdmissionRefresher()
      releaseProfileAdmissionFencer()
      const closing = close(server)
      for (const connection of connections) connection.shutdown()
      await closing
      if (removeEndpointAfterClose) await removeLocalSessionEndpoint(endpoint)
    },
    removeEndpoint: () => removeLocalSessionEndpoint(endpoint),
    outboundByteUsage: () => ({
      pendingBytes: outboundBudget.pendingBytes,
      peakBytes: outboundBudget.peakBytes,
      maxBytes: outboundBudget.maxBytes,
    }),
  }
}
