import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import * as Effect from 'effect/Effect'
import {
  authorizeLocalSessionActiveRun,
  authorizeLocalSessionEvent,
  dispatchLocalSessionCommand,
} from '../application/local-session-command-dispatcher'
import { refreshNamedProfileCaller } from '../application/local-session-derived-authority'
import { authenticateLocalSessionProfile } from '../application/local-session-profile-authentication'
import { LocalSessionProfileRepository } from '../ports/local-session-profile-repository'
import type { AppServices } from '../runtime'
import { SettingsService } from '../services/settings-service'
import { listStreamBufferSnapshots } from '../utils/stream-buffer'
import { createLocalSessionAuthenticator } from './local-session-authenticator'
import {
  exposeLocalSessionCommandResultCursor,
  resolveLocalSessionCommandCursor,
} from './local-session-command-event-cursors'
import { isWindowsPipe } from './local-session-endpoint'
import { startLocalSessionHost } from './local-session-host-runtime'
import type { LocalSessionHostPaths } from './local-session-paths'
import { createLocalSessionServerAuthenticator } from './local-session-server-authentication'
import { ensureLocalUserCredential } from './local-user-credential'
import type { SessionHostOwnership } from './session-host-ownership'
import { recoverHostState } from './session-host-state-recovery'
import { readSessionHostUpgradeBlockers } from './session-host-upgrade-blockers'

type AppEffectRunner = <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<A>

export async function startAppSessionHost(input: {
  readonly paths: LocalSessionHostPaths
  readonly externalOwnership?: SessionHostOwnership
  readonly runEffect: AppEffectRunner
  readonly startOwnedServices: () => Promise<void>
  readonly stopOwnedServices: () => Promise<void>
}) {
  const localUserCredential = await ensureLocalUserCredential(input.paths.credentialPath)
  const settings = await input.runEffect(
    Effect.gen(function* () {
      const service = yield* SettingsService
      return yield* service.get()
    }),
  )
  const authenticateCaller = createLocalSessionAuthenticator({
    localUserCredential,
    namedProfiles: {
      authenticate: (profileInput) =>
        input.runEffect(
          authenticateLocalSessionProfile({
            ...profileInput,
            now: Date.now(),
          }),
        ),
    },
  })
  const authenticate = async (hello: Parameters<typeof authenticateCaller>[0]) =>
    input.runEffect(refreshNamedProfileCaller(await authenticateCaller(hello)))
  const authenticateServer = createLocalSessionServerAuthenticator({
    localUserCredential,
    resolveProfileCredentialVerifier: (profile) =>
      input.runEffect(
        Effect.gen(function* () {
          const repository = yield* LocalSessionProfileRepository
          const record = yield* repository.findForAuthentication(profile)
          return record?.revokedAt === null ? record.credentialVerifier : null
        }),
      ),
  })

  return startLocalSessionHost({
    endpoint: input.paths.endpoint,
    databasePath: input.paths.databasePath,
    ...(isWindowsPipe(input.paths.endpoint) ? { authenticateServer } : {}),
    ...(input.externalOwnership ? { externalOwnership: input.externalOwnership } : {}),
    idleGracePeriodMs: settings.sessionHostIdleGracePeriodMs,
    readIdleGracePeriod: () =>
      input.runEffect(
        Effect.gen(function* () {
          const service = yield* SettingsService
          return (yield* service.get()).sessionHostIdleGracePeriodMs
        }),
      ),
    authenticate,
    authorizeEvent: (caller, event) => input.runEffect(authorizeLocalSessionEvent(caller, event)),
    refreshCaller: (caller) => input.runEffect(refreshNamedProfileCaller(caller)),
    snapshotActiveRuns: () => listStreamBufferSnapshots(),
    authorizeActiveRun: (caller, snapshot) =>
      input.runEffect(authorizeLocalSessionActiveRun(caller, snapshot.sessionId)),
    recover: () => input.runEffect(recoverHostState()),
    describeUpgradeBlockers: async () => readSessionHostUpgradeBlockers(input.paths.databasePath),
    startOwnedServices: input.startOwnedServices,
    stopOwnedServices: input.stopOwnedServices,
    dispatch: async ({
      caller,
      negotiatedRevision,
      eventCursor,
      payload,
      signal,
      releaseAdmissionReader,
      resolveEventCursor,
      exposeEventCursor,
    }) => {
      const decodedPayload = decodeLocalSessionCommandPayloadForRevision(
        payload,
        negotiatedRevision,
      )
      const cursorResolution = resolveLocalSessionCommandCursor(decodedPayload, resolveEventCursor)
      const result =
        cursorResolution.status === 'resync-required'
          ? cursorResolution.result
          : await input.runEffect(
              dispatchLocalSessionCommand({
                caller,
                negotiatedRevision,
                payload: cursorResolution.payload,
                signal,
                beforeProfileRefresh: releaseAdmissionReader,
              }),
            )
      const exposedResult = exposeLocalSessionCommandResultCursor(result, exposeEventCursor)
      return exposedResult.contract === 'session-query-v2'
        ? { ...exposedResult, response: { ...exposedResult.response, eventCursor } }
        : exposedResult
    },
  })
}
