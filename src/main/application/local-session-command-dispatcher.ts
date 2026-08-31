import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionLifecycleResponse } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import {
  requiredSessionControlCapabilities,
  requiredSessionLifecycleCapabilities,
} from '../domain/session-control/session-capability-authorization'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { SettingsService } from '../services/settings-service'
import { refreshLocalSessionProfileAdmissions } from '../session-host/local-session-profile-invalidation'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { dispatchConfiguredGuiSessionCommand } from './gui-session-command-router'
import { dispatchHostUiRequest } from './host-ui-request-dispatcher'
import {
  authorizeLocalSessionCommand,
  profileAuthorityForCapabilities,
  refreshNamedProfileCaller,
} from './local-session-command-authorization'
import {
  canonicalizeNamedProfileProjectPayload,
  scopeNamedProfileExport,
} from './local-session-command-scoping'
import { authorizeTargetForCaller } from './local-session-derived-authority'
import {
  acquireLocalSessionMutationAdmission,
  type LocalSessionMutationAdmission,
} from './local-session-mutation-admission'
import {
  dispatchOwnerLocalSessionCommand,
  isLocallyHandledCommand,
} from './local-session-owned-command'
import { manageLocalSessionProfiles } from './local-session-profile-management'
import { dispatchSessionQuery } from './local-session-query-dispatcher'
import {
  executeLocalUiSessionCommand,
  prepareLocalGuiAttachments,
} from './local-ui-session-service'
import { preserveOutcomeAfterAttachmentCleanup } from './session-attachment-cleanup'
import { prepareSessionCommandAttachments } from './session-command-attachment-preparation'
import { bindSessionControlAttachments } from './session-control-command-attachments'
import { executeSessionControlMutation } from './session-control-command-service'
import { publishControlResponse } from './session-control-event-projection'
import { executeSessionLifecycleCommand } from './session-lifecycle-command-service'

export {
  type ConfiguredHostUiInvocation,
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
  type GuiSessionCommandDependencies,
  GuiSessionHostRetiredForUpgradeError,
  invokeConfiguredHostUi,
  invokeConfiguredHostUiRaw,
  retireGuiSessionCommandClientForUpgrade,
} from './gui-session-command-router'
export {
  authorizeLocalSessionActiveRun,
  authorizeLocalSessionCommand,
  authorizeLocalSessionEvent,
  profileAuthorityForCapabilities,
} from './local-session-command-authorization'

function publishLifecycleResponse(response: SessionLifecycleResponse) {
  if (response.replayed || response.outcome.effect === 'rejected') return
  publishSessionHostEvent({
    kind: 'session-list-changed',
    sessionId: response.outcome.sessionId,
    change: 'created',
  })
  publishSessionHostEvent({
    kind: 'session-state-changed',
    sessionId: response.outcome.sessionId,
    stateRevision:
      response.outcome.effect === 'created-root' || response.outcome.effect === 'forked-session'
        ? 0
        : 1,
    operation: response.outcome.operation,
  })
}

function refreshAdmissionBeforeStartedLifecycleProjection(response: SessionLifecycleResponse) {
  if (
    response.replayed ||
    (response.outcome.effect !== 'launched-root' && response.outcome.effect !== 'spawned-worker')
  ) {
    return Effect.void
  }
  return Effect.promise(() => refreshLocalSessionProfileAdmissions())
}

function refreshAdmissionBeforeIdleLifecycleProjection(response: SessionLifecycleResponse) {
  if (
    response.replayed ||
    (response.outcome.effect !== 'created-root' && response.outcome.effect !== 'forked-session')
  ) {
    return Effect.void
  }
  return Effect.promise(() => refreshLocalSessionProfileAdmissions())
}

export function lifecycleCallerCapabilities(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-lifecycle-v2' }>,
) {
  const authority = caller.profileAuthority
  if (!authority) return Effect.succeed(undefined)
  const command = payload.request.command
  if (command.operation !== 'spawn' && command.operation !== 'fork') {
    return Effect.succeed(authority.capabilities)
  }
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    const target = yield* repository.resolve(
      command.operation === 'spawn' ? command.parentSessionId : command.sourceSessionId,
    )
    const authorization = authorizeTargetForCaller(
      caller,
      target,
      requiredSessionLifecycleCapabilities(command),
    )
    if (!authorization.authorized) return authority.capabilities
    return 'derived' in authorization ? authorization.derived.capabilities : authority.capabilities
  })
}

type NonHostUiLocalSessionCommandPayload = Exclude<
  LocalSessionCommandPayload,
  { readonly contract: 'host-ui-v1' }
>

export function dispatchNonHostUiLocalSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: NonHostUiLocalSessionCommandPayload
  readonly signal?: AbortSignal
  readonly mutationAdmission?: () => Promise<LocalSessionMutationAdmission>
}) {
  const commandPayload = input.payload
  const ownerLocal = dispatchOwnerLocalSessionCommand(input)
  if (ownerLocal) return ownerLocal
  return Effect.gen(function* () {
    const caller = yield* refreshNamedProfileCaller(input.caller)
    if (commandPayload.contract === 'local-attachments-v1') {
      return yield* prepareLocalGuiAttachments({ caller, payload: commandPayload })
    }
    if (commandPayload.contract === 'local-ui-v1') {
      return yield* executeLocalUiSessionCommand({ caller, payload: commandPayload })
    }
    const canonicalPayload = yield* canonicalizeNamedProfileProjectPayload(caller, commandPayload)
    yield* authorizeLocalSessionCommand({ caller, payload: canonicalPayload })
    const scopedPayload = yield* scopeNamedProfileExport(caller, canonicalPayload)
    const payload = yield* prepareSessionCommandAttachments({
      payload: scopedPayload,
      caller,
      ...(caller.workingDirectory ? { workingDirectory: caller.workingDirectory } : {}),
    })
    if (isLocallyHandledCommand(payload)) {
      return yield* Effect.fail(new Error('Local Session command preparation returned invalid.'))
    }
    if (payload.contract === 'host-ui-v1') {
      return yield* Effect.fail(new Error('Host UI command preparation returned invalid.'))
    }

    if (payload.contract === 'local-access-v1') {
      const response = yield* manageLocalSessionProfiles({
        caller,
        request: payload.request,
        now: Date.now(),
      })
      return { contract: 'local-access-v1', response } as const
    }

    if (payload.contract === 'session-query-v2') {
      return yield* dispatchSessionQuery(caller, payload, input.signal)
    }

    const admission = yield* acquireLocalSessionMutationAdmission(input, caller)
    return yield* Effect.gen(function* () {
      const admittedPayload = payload
      yield* authorizeLocalSessionCommand({ caller: admission.caller, payload: admittedPayload })
      if (input.signal?.aborted) {
        return yield* Effect.fail(
          input.signal.reason instanceof Error ? input.signal.reason : new Error('aborted'),
        )
      }
      if (admittedPayload.contract === 'session-control-v2') {
        const attachmentService = yield* SessionControlAttachmentService
        return yield* preserveOutcomeAfterAttachmentCleanup({
          effect: Effect.gen(function* () {
            yield* bindSessionControlAttachments(admission.caller, admittedPayload)
            const settings = yield* SettingsService
            const snapshot = yield* settings.get()
            const authority = profileAuthorityForCapabilities(
              admission.caller,
              requiredSessionControlCapabilities(admittedPayload.request.command),
            )
            const response = yield* executeSessionControlMutation({
              callerId: admission.caller.callerId,
              caller: admission.caller,
              hostRunCeiling: snapshot.sessionHostRunCeiling,
              ...(authority ? { authority } : {}),
              request: admittedPayload.request,
            })
            publishControlResponse(response)
            return { contract: 'session-control-v2', response } as const
          }),
          cleanup: attachmentService.cleanupUnreferenced({
            sessionId: admittedPayload.request.command.sessionId,
          }),
          operation: 'command',
          sessionId: admittedPayload.request.command.sessionId,
        }).pipe(Effect.uninterruptible)
      }
      const callerCapabilities = yield* lifecycleCallerCapabilities(
        admission.caller,
        admittedPayload,
      )
      return yield* Effect.gen(function* () {
        const response = yield* executeSessionLifecycleCommand({
          callerId: admission.caller.callerId,
          ...(admission.caller.profileAuthority && callerCapabilities
            ? {
                callerCapabilities,
                callerAuthorizationCeiling: admission.caller.profileAuthority.authorizationCeiling,
                callerAuthorityScope:
                  admission.caller.baseProfileScope ?? admission.caller.profileAuthority.scope,
              }
            : {}),
          ...(admission.caller.workingDirectory
            ? { initiatingWorkingDirectory: admission.caller.workingDirectory }
            : {}),
          request: admittedPayload.request,
          beforeDispatchAcceptedRun: refreshAdmissionBeforeStartedLifecycleProjection,
        })
        yield* refreshAdmissionBeforeIdleLifecycleProjection(response)
        publishLifecycleResponse(response)
        return { contract: 'session-lifecycle-v2', response } as const
      }).pipe(Effect.uninterruptible)
    }).pipe(Effect.ensuring(Effect.sync(admission.release)))
  })
}

export function dispatchLocalSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalSessionCommandPayload
  readonly negotiatedRevision?: number
  readonly signal?: AbortSignal
}) {
  const remote = dispatchConfiguredGuiSessionCommand(input)
  if (remote) return remote
  if (input.payload.contract === 'host-ui-v1') {
    return dispatchHostUiRequest({
      caller: input.caller,
      request: input.payload.request,
      ...(input.negotiatedRevision !== undefined
        ? { negotiatedRevision: input.negotiatedRevision }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  }
  return dispatchNonHostUiLocalSessionCommand({
    ...input,
    payload: input.payload,
  })
}

export {
  canonicalizeNamedProfileProjectPayload,
  scopeNamedProfileExport,
} from './local-session-command-scoping'
export {
  dispatchSessionQuery,
  dispatchSessionWaitQuery,
} from './local-session-query-dispatcher'
