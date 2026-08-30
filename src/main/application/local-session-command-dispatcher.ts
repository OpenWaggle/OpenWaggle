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
import {
  executeLocalSessionCommand,
  type LocalSessionClientConnectionInput,
} from '../session-host/local-session-client'
import {
  ensureLocalSessionHost,
  isLocalSessionHostUnavailable,
} from '../session-host/local-session-host-launcher'
import { publishSessionHostEvent } from '../session-host/session-host-events'
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
import { executeSessionControlMutation } from './session-control-command-service'
import { publishControlResponse } from './session-control-event-projection'
import { executeSessionLifecycleCommand } from './session-lifecycle-command-service'

export {
  authorizeLocalSessionActiveRun,
  authorizeLocalSessionCommand,
  authorizeLocalSessionEvent,
  profileAuthorityForCapabilities,
} from './local-session-command-authorization'

type GuiSessionClientInput = Omit<
  LocalSessionClientConnectionInput,
  'workingDirectory' | 'clientKind'
>

type GuiSessionCommandRoute =
  | { readonly mode: 'local' }
  | { readonly mode: 'remote'; readonly client: GuiSessionClientInput }
  | { readonly mode: 'retired-for-upgrade' }

let guiSessionCommandRoute: GuiSessionCommandRoute = { mode: 'local' }

export class GuiSessionHostRetiredForUpgradeError extends Error {
  constructor() {
    super('This OpenWaggle window retired its Session Host for an upgrade. Restart it to continue.')
    this.name = 'GuiSessionHostRetiredForUpgradeError'
  }
}

export interface GuiSessionCommandDependencies {
  readonly execute: typeof executeLocalSessionCommand
  readonly ensure: (input: Parameters<typeof ensureLocalSessionHost>[0]) => Promise<unknown>
}

function cannotRetryAfterAmbiguousTransportFailure(payload: LocalSessionCommandPayload) {
  return payload.contract === 'session-waggle-v1' || payload.contract === 'local-compaction-v1'
}

export function configureGuiSessionCommandClient(input: GuiSessionClientInput | null) {
  guiSessionCommandRoute = input ? { mode: 'remote', client: input } : { mode: 'local' }
}

export function retireGuiSessionCommandClientForUpgrade() {
  guiSessionCommandRoute = { mode: 'retired-for-upgrade' }
}

export function dispatchConfiguredGuiSessionCommand(
  input: {
    readonly caller: LocalSessionCallerIdentity
    readonly payload: LocalSessionCommandPayload
  },
  dependencyOverrides: Partial<GuiSessionCommandDependencies> = {},
) {
  const dependencies: GuiSessionCommandDependencies = {
    execute: executeLocalSessionCommand,
    ensure: ensureLocalSessionHost,
    ...dependencyOverrides,
  }
  const route = guiSessionCommandRoute
  if (input.caller.callerId !== 'gui:local-user' || route.mode === 'local') return undefined
  if (route.mode === 'retired-for-upgrade') {
    return Effect.fail(new GuiSessionHostRetiredForUpgradeError())
  }
  const configuredGuiClient = route.client
  const commandInput = {
    ...configuredGuiClient,
    clientKind: 'gui' as const,
    ...(input.caller.workingDirectory ? { workingDirectory: input.caller.workingDirectory } : {}),
    payload: input.payload,
  }
  return Effect.tryPromise(async () => {
    try {
      return await dependencies.execute(commandInput)
    } catch (error) {
      if (
        !isLocalSessionHostUnavailable(error) ||
        cannotRetryAfterAmbiguousTransportFailure(input.payload)
      ) {
        throw error
      }
      await dependencies.ensure({
        ...configuredGuiClient,
        clientKind: 'gui',
      })
      return dependencies.execute(commandInput)
    }
  })
}

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

function controlAttachmentIds(
  command: Extract<
    LocalSessionCommandPayload,
    { contract: 'session-control-v2' }
  >['request']['command'],
): readonly string[] {
  if (
    command.operation === 'message' ||
    command.operation === 'start' ||
    command.operation === 'follow-up' ||
    command.operation === 'steer' ||
    command.operation === 'replace'
  ) {
    return command.input.attachmentIds
  }
  return []
}

function bindSessionControlAttachments(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-control-v2' }>,
) {
  const attachmentIds = controlAttachmentIds(payload.request.command)
  return attachmentIds.length === 0
    ? Effect.void
    : SessionControlAttachmentService.pipe(
        Effect.flatMap((service) =>
          service.bind({
            attachmentIds,
            sessionId: payload.request.command.sessionId,
            ownerCallerId: caller.callerId,
          }),
        ),
      )
}

export function dispatchLocalSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalSessionCommandPayload
  readonly signal?: AbortSignal
}) {
  const remote = dispatchConfiguredGuiSessionCommand(input)
  if (remote) return remote
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

    if (payload.contract === 'session-control-v2') {
      const attachmentService = yield* SessionControlAttachmentService
      return yield* preserveOutcomeAfterAttachmentCleanup({
        effect: Effect.gen(function* () {
          yield* bindSessionControlAttachments(caller, payload)
          const settings = yield* SettingsService
          const snapshot = yield* settings.get()
          const authority = profileAuthorityForCapabilities(
            caller,
            requiredSessionControlCapabilities(payload.request.command),
          )
          const response = yield* executeSessionControlMutation({
            callerId: caller.callerId,
            hostRunCeiling: snapshot.sessionHostRunCeiling,
            ...(authority ? { authority } : {}),
            request: payload.request,
          })
          publishControlResponse(response)
          return { contract: 'session-control-v2', response } as const
        }),
        cleanup: attachmentService.cleanupUnreferenced({
          sessionId: payload.request.command.sessionId,
        }),
        operation: 'command',
        sessionId: payload.request.command.sessionId,
      })
    }
    const callerCapabilities = yield* lifecycleCallerCapabilities(caller, payload)
    const response = yield* executeSessionLifecycleCommand({
      callerId: caller.callerId,
      ...(caller.profileAuthority && callerCapabilities
        ? {
            callerCapabilities,
            callerAuthorizationCeiling: caller.profileAuthority.authorizationCeiling,
            callerAuthorityScope: caller.baseProfileScope ?? caller.profileAuthority.scope,
          }
        : {}),
      ...(caller.workingDirectory ? { initiatingWorkingDirectory: caller.workingDirectory } : {}),
      request: payload.request,
    })
    publishLifecycleResponse(response)
    return { contract: 'session-lifecycle-v2', response } as const
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
