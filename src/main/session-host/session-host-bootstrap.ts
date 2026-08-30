import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import * as Effect from 'effect/Effect'
import { recoverPendingManagedWorktreeRemovals } from '../application/host-ui-worktree-operation'
import {
  authorizeLocalSessionActiveRun,
  authorizeLocalSessionEvent,
  dispatchLocalSessionCommand,
} from '../application/local-session-command-dispatcher'
import { refreshNamedProfileCaller } from '../application/local-session-derived-authority'
import { authenticateLocalSessionProfile } from '../application/local-session-profile-authentication'
import { recoverSessionExportsAfterHostLoss } from '../application/session-export-recovery'
import { recoverPendingSessionHandoffs } from '../application/session-organization-service'
import { createLogger } from '../logger'
import { SessionHostRecoveryRepository } from '../ports/session-host-recovery-repository'
import { SessionLifecyclePreparationService } from '../ports/session-lifecycle-preparation-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { AppServices } from '../runtime'
import { SettingsService } from '../services/settings-service'
import { listStreamBufferSnapshots } from '../utils/stream-buffer'
import { createLocalSessionAuthenticator } from './local-session-authenticator'
import { startLocalSessionHost } from './local-session-host-runtime'
import type { LocalSessionHostPaths } from './local-session-paths'
import { ensureLocalUserCredential } from './local-user-credential'
import type { SessionHostOwnership } from './session-host-ownership'
import { readSessionHostUpgradeBlockers } from './session-host-upgrade-blockers'

type AppEffectRunner = <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<A>

const logger = createLogger('session-host/bootstrap')

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
  const authenticate = createLocalSessionAuthenticator({
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

  return startLocalSessionHost({
    endpoint: input.paths.endpoint,
    databasePath: input.paths.databasePath,
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
    recover: () =>
      input.runEffect(
        Effect.gen(function* () {
          const repository = yield* SessionHostRecoveryRepository
          const projection = yield* SessionProjectionRepository
          const lifecyclePreparation = yield* SessionLifecyclePreparationService
          const recovery = yield* repository.recoverAfterHostLoss(Date.now())
          const removalRecovery = yield* recoverPendingManagedWorktreeRemovals(
            recovery.pendingWorktreeRemovals,
          )
          for (const result of removalRecovery) {
            if (result.outcome._tag === 'Left') {
              logger.error('Pending managed worktree removal recovery failed closed.', {
                resourceId: result.resourceId,
                error: result.outcome.left.message,
              })
            }
          }
          yield* projection.recoverPendingDeletions?.() ?? Effect.void
          yield* lifecyclePreparation.recoverPending
          const handoffRecovery = yield* recoverPendingSessionHandoffs(recovery.pendingHandoffs)
          for (const result of handoffRecovery) {
            if (result._tag === 'Left') {
              logger.error('Pending Workspace handoff recovery exhausted retries.', {
                error: result.left instanceof Error ? result.left.message : String(result.left),
              })
            }
          }
          yield* recoverSessionExportsAfterHostLoss()
        }),
      ),
    describeUpgradeBlockers: async () => readSessionHostUpgradeBlockers(input.paths.databasePath),
    startOwnedServices: input.startOwnedServices,
    stopOwnedServices: input.stopOwnedServices,
    dispatch: async ({ caller, negotiatedRevision, eventCursor, payload, signal }) => {
      const result = await input.runEffect(
        dispatchLocalSessionCommand({
          caller,
          payload: decodeLocalSessionCommandPayloadForRevision(payload, negotiatedRevision),
          signal,
        }),
      )
      return result.contract === 'session-query-v2'
        ? { ...result, response: { ...result.response, eventCursor } }
        : result
    },
  })
}
