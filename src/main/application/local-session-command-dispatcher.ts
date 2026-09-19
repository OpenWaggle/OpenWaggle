import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import {
  requiredSessionControlCapabilities,
  requiredSessionLifecycleCapabilities,
} from '../domain/session-control/session-capability-authorization'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { SettingsService } from '../services/settings-service'
import { dispatchDesktopServiceRequest } from './desktop-service-request-dispatcher'
import { dispatchConfiguredGuiSessionCommand } from './gui-session-command-router'
import { dispatchHostUiRequest } from './host-ui-request-dispatcher'
import { acquirePreparedLocalSessionMutation } from './local-session-admitted-mutation'
import {
  authorizeLocalSessionCommand,
  profileAuthorityForCapabilities,
  refreshNamedProfileCaller,
} from './local-session-command-authorization'
import { authorizeTargetForCaller } from './local-session-derived-authority'
import type {
  LocalSessionMutationAdmission,
  LocalSessionObservationAdmission,
} from './local-session-mutation-admission'
import { dispatchObservedLocalSessionQuery } from './local-session-observed-query'
import { dispatchOwnerLocalSessionCommand } from './local-session-owned-command'
import { manageLocalSessionProfiles } from './local-session-profile-management'
import {
  executeLocalUiSessionCommand,
  prepareLocalGuiAttachments,
} from './local-ui-session-service'
import {
  preserveOutcomeAfterAttachmentCleanup,
  withSessionAttachmentTransition,
} from './session-attachment-cleanup'
import { bindSessionControlAttachments } from './session-control-command-attachments'
import {
  executeSessionControlMutation,
  isSessionControlInterruption,
} from './session-control-command-service'
import { publishControlResponse } from './session-control-event-projection'
import { executeSessionLifecycleCommand } from './session-lifecycle-command-service'
import {
  publishLifecycleResponse,
  refreshAdmissionBeforeIdleLifecycleProjection,
  refreshAdmissionBeforeStartedLifecycleProjection,
} from './session-lifecycle-event-projection'

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
  { readonly contract: 'host-ui-v1' | 'desktop-service-v1' }
>

interface NonHostUiLocalSessionCommandInput {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: NonHostUiLocalSessionCommandPayload
  readonly signal?: AbortSignal
  readonly mutationAdmission?: () => Promise<LocalSessionMutationAdmission>
  readonly observationAdmission?: () => Promise<LocalSessionObservationAdmission>
  readonly beforeProfileRefresh?: () => void
}

export function dispatchAdmittedSessionControlCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: Extract<LocalSessionCommandPayload, { readonly contract: 'session-control-v2' }>
}) {
  const sessionId = input.payload.request.command.sessionId
  const executeCommand = Effect.gen(function* () {
    yield* bindSessionControlAttachments(input.caller, input.payload)
    const settings = yield* SettingsService
    const snapshot = yield* settings.get()
    const authority = profileAuthorityForCapabilities(
      input.caller,
      requiredSessionControlCapabilities(input.payload.request.command),
    )
    const response = yield* executeSessionControlMutation({
      callerId: input.caller.callerId,
      caller: input.caller,
      hostRunCeiling: snapshot.sessionHostRunCeiling,
      ...(authority ? { authority } : {}),
      request: input.payload.request,
    })
    publishControlResponse(response)
    return { contract: 'session-control-v2', response } as const
  })
  if (isSessionControlInterruption(input.payload.request.command)) {
    return executeCommand.pipe(Effect.uninterruptible)
  }
  return Effect.gen(function* () {
    const attachmentService = yield* SessionControlAttachmentService
    return yield* preserveOutcomeAfterAttachmentCleanup({
      effect: withSessionAttachmentTransition({
        sessionId,
        effect: executeCommand,
      }),
      cleanup: withSessionAttachmentTransition({
        sessionId,
        effect: attachmentService.cleanupUnreferenced({ sessionId }),
      }),
      operation: 'command',
      sessionId,
    })
  }).pipe(Effect.uninterruptible)
}

type NonHostUiLocalSessionQueryInput = NonHostUiLocalSessionCommandInput & {
  readonly payload: Extract<LocalSessionCommandPayload, { readonly contract: 'session-query-v2' }>
}

function dispatchNonHostUiLocalSessionCommandImplementation(
  input: NonHostUiLocalSessionCommandInput,
) {
  const commandPayload = input.payload
  const ownerLocal = dispatchOwnerLocalSessionCommand(input)
  if (ownerLocal) return ownerLocal
  return Effect.gen(function* () {
    const nativeMutation =
      input.mutationAdmission !== undefined &&
      (commandPayload.contract === 'session-control-v2' ||
        commandPayload.contract === 'session-lifecycle-v2')
    const caller = nativeMutation ? input.caller : yield* refreshNamedProfileCaller(input.caller)
    if (commandPayload.contract === 'local-attachments-v1') {
      return yield* prepareLocalGuiAttachments({ caller, payload: commandPayload })
    }
    if (commandPayload.contract === 'local-ui-v1') {
      return yield* executeLocalUiSessionCommand({ caller, payload: commandPayload })
    }
    if (commandPayload.contract === 'session-query-v2') {
      return yield* dispatchObservedLocalSessionQuery({
        caller,
        payload: commandPayload,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.observationAdmission ? { observationAdmission: input.observationAdmission } : {}),
      })
    }
    if (commandPayload.contract === 'local-access-v1') {
      yield* authorizeLocalSessionCommand({ caller, payload: commandPayload })
      const response = yield* manageLocalSessionProfiles({
        caller,
        request: commandPayload.request,
        now: Date.now(),
      })
      return { contract: 'local-access-v1', response } as const
    }
    if (
      commandPayload.contract !== 'session-control-v2' &&
      commandPayload.contract !== 'session-lifecycle-v2'
    ) {
      return yield* Effect.die('Local mutation routing returned an invalid contract.')
    }
    const admission = yield* acquirePreparedLocalSessionMutation({
      caller,
      payload: commandPayload,
      ...(input.mutationAdmission ? { mutationAdmission: input.mutationAdmission } : {}),
    })
    return yield* Effect.gen(function* () {
      const admittedCaller = admission.caller
      const admittedPayload = admission.payload
      if (input.signal?.aborted) {
        return yield* Effect.fail(
          input.signal.reason instanceof Error ? input.signal.reason : new Error('aborted'),
        )
      }
      if (admittedPayload.contract === 'session-control-v2') {
        return yield* dispatchAdmittedSessionControlCommand({
          caller: admittedCaller,
          payload: admittedPayload,
        })
      }
      const callerCapabilities = yield* lifecycleCallerCapabilities(admittedCaller, admittedPayload)
      return yield* Effect.gen(function* () {
        const response = yield* executeSessionLifecycleCommand({
          callerId: admittedCaller.callerId,
          ...(admittedCaller.profileAuthority && callerCapabilities
            ? {
                callerCapabilities,
                callerAuthorizationCeiling: admittedCaller.profileAuthority.authorizationCeiling,
                callerAuthorityScope:
                  admittedCaller.baseProfileScope ?? admittedCaller.profileAuthority.scope,
              }
            : {}),
          ...(admittedCaller.workingDirectory
            ? { initiatingWorkingDirectory: admittedCaller.workingDirectory }
            : {}),
          request: admittedPayload.request,
          beforeDispatchAcceptedRun: (response) =>
            refreshAdmissionBeforeStartedLifecycleProjection(response, input.beforeProfileRefresh),
        })
        yield* refreshAdmissionBeforeIdleLifecycleProjection(response, input.beforeProfileRefresh)
        publishLifecycleResponse(response)
        return { contract: 'session-lifecycle-v2', response } as const
      }).pipe(Effect.uninterruptible)
    }).pipe(Effect.ensuring(Effect.sync(admission.release)))
  })
}

type NonHostUiLocalSessionCommandEffect = ReturnType<
  typeof dispatchNonHostUiLocalSessionCommandImplementation
>

export function dispatchNonHostUiLocalSessionCommand(
  input: NonHostUiLocalSessionQueryInput,
): ReturnType<typeof dispatchObservedLocalSessionQuery>
export function dispatchNonHostUiLocalSessionCommand(
  input: NonHostUiLocalSessionCommandInput,
): NonHostUiLocalSessionCommandEffect
export function dispatchNonHostUiLocalSessionCommand(
  input: NonHostUiLocalSessionCommandInput,
): NonHostUiLocalSessionCommandEffect {
  return dispatchNonHostUiLocalSessionCommandImplementation(input)
}

export function dispatchLocalSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalSessionCommandPayload
  readonly negotiatedRevision?: number
  readonly signal?: AbortSignal
  readonly beforeProfileRefresh?: () => void
}) {
  const remote = dispatchConfiguredGuiSessionCommand(input)
  if (remote) return remote
  if (input.payload.contract === 'desktop-service-v1') {
    return dispatchDesktopServiceRequest({
      caller: input.caller,
      request: input.payload.request,
      ...(input.negotiatedRevision !== undefined
        ? { negotiatedRevision: input.negotiatedRevision }
        : {}),
    })
  }
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
