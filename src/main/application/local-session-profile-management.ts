import { matchBy } from '@diegogbrisa/ts-match'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type {
  LocalSessionProfileManagementOutcome,
  LocalSessionProfileManagementRequest,
} from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'
import { LocalSessionProfileRepository } from '../ports/local-session-profile-repository'
import {
  fenceLocalSessionProfileAdmissions,
  refreshLocalSessionProfileAdmissions,
} from '../session-host/local-session-profile-invalidation'
import {
  fenceLocalSessionProfileBackgroundWork,
  releaseLocalSessionProfileBackgroundWorkFence,
} from './local-session-profile-background-work'
import {
  profileManagementEligibilityRejectionReason,
  profileManagementRejection,
  profileManagementRejectionReason,
  profileManagementTargetName,
} from './local-session-profile-management-policy'
import {
  canonicalizeLocalSessionProfilePolicyCommand,
  prepareLocalSessionProfileCredential,
} from './local-session-profile-management-preparation'
import { withLocalSessionProfileMutationLock } from './local-session-profile-mutation-lock'

export { canManageLocalSessionProfiles } from './local-session-profile-management-policy'

function interruptRevokedRuns(outcome: LocalSessionProfileManagementOutcome, replayed: boolean) {
  if (replayed || outcome.effect !== 'profile-revoked') return Effect.void
  return Effect.gen(function* () {
    const interruption = yield* AgentRunInterruptionService
    yield* Effect.forEach(outcome.interruptedRuns, (run) => interruption.interrupt(run), {
      concurrency: 'unbounded',
      discard: true,
    })
  })
}

function refreshProfileAdmissionAfterManagement(
  outcome: LocalSessionProfileManagementOutcome,
  fencedProfileName: string | undefined,
) {
  return matchBy(outcome, 'effect')
    .with('profile-updated', (updated) =>
      Effect.promise(() =>
        refreshLocalSessionProfileAdmissions(updated.profile.id, {
          consumeExistingFence: true,
        }),
      ),
    )
    .with('rejected', () =>
      fencedProfileName
        ? Effect.promise(() =>
            refreshLocalSessionProfileAdmissions(undefined, { consumeExistingFence: true }),
          )
        : Effect.void,
    )
    .with(
      'profiles-listed',
      'profile-created',
      'profile-rotated',
      'profile-revoked',
      () => Effect.void,
    )
    .exhaustive()
}

export function manageLocalSessionProfiles(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly request: LocalSessionProfileManagementRequest
  readonly now: number
}) {
  return Effect.gen(function* () {
    const eligibilityReason = profileManagementEligibilityRejectionReason(
      input.caller,
      input.request.command,
    )
    if (eligibilityReason) {
      return profileManagementRejection(
        input.request,
        eligibilityReason,
        profileManagementTargetName(input.request.command),
      )
    }
    const command = yield* canonicalizeLocalSessionProfilePolicyCommand(input.request.command)
    const request = { ...input.request, command }
    const reason = profileManagementRejectionReason(input.caller, command)
    if (reason) {
      return profileManagementRejection(request, reason, profileManagementTargetName(command))
    }
    const repository = yield* LocalSessionProfileRepository
    const preparedCredential = yield* prepareLocalSessionProfileCredential({
      callerId: input.caller.callerId,
      idempotencyKey: request.idempotencyKey,
      command,
    })
    const fencedProfileName =
      command.operation === 'update' ||
      command.operation === 'rotate' ||
      command.operation === 'revoke'
        ? command.profileName.trim()
        : undefined
    const backgroundFenceProfile =
      command.operation === 'update' || command.operation === 'revoke'
        ? yield* repository.findForAuthentication(command.profileName.trim())
        : null
    const execute = Effect.gen(function* () {
      if (fencedProfileName) {
        yield* Effect.promise(() => fenceLocalSessionProfileAdmissions(fencedProfileName))
      }
      const response = yield* repository
        .executeManagement({
          actorCallerId: input.caller.callerId,
          request,
          ...(preparedCredential ? { preparedCredential } : {}),
          now: input.now,
        })
        .pipe(
          Effect.tapError(() =>
            fencedProfileName
              ? Effect.promise(() =>
                  refreshLocalSessionProfileAdmissions(undefined, {
                    consumeExistingFence: true,
                  }),
                )
              : Effect.void,
          ),
        )
      yield* refreshProfileAdmissionAfterManagement(response.outcome, fencedProfileName)
      yield* interruptRevokedRuns(response.outcome, response.replayed)
      return response
    })
    const backgroundFencedExecution = backgroundFenceProfile
      ? Effect.acquireUseRelease(
          Effect.promise(() => fenceLocalSessionProfileBackgroundWork(backgroundFenceProfile.id)),
          () => execute,
          () =>
            Effect.sync(() =>
              releaseLocalSessionProfileBackgroundWorkFence(backgroundFenceProfile.id),
            ),
        )
      : execute
    return yield* fencedProfileName
      ? withLocalSessionProfileMutationLock(fencedProfileName, backgroundFencedExecution)
      : backgroundFencedExecution
  })
}
