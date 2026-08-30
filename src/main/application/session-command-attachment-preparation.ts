import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionControlMutationCommand } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'

type AttachmentControlCommand = Extract<
  SessionControlMutationCommand,
  { operation: 'message' | 'start' | 'follow-up' | 'steer' | 'replace' }
>

function isAttachmentControlCommand(
  command: SessionControlMutationCommand,
): command is AttachmentControlCommand {
  return (
    command.operation === 'message' ||
    command.operation === 'start' ||
    command.operation === 'follow-up' ||
    command.operation === 'steer' ||
    command.operation === 'replace'
  )
}

function preparePaths(input: {
  readonly baseDirectory: string
  readonly paths: readonly string[]
  readonly ownerCallerId: string
  readonly requestId: string
  readonly allowedRoots?: readonly string[]
}) {
  return Effect.gen(function* () {
    const service = yield* SessionControlAttachmentService
    const attachments = yield* service.prepare({
      baseDirectory: input.baseDirectory,
      entries: input.paths.map((path) => ({ path })),
      ownerCallerId: input.ownerCallerId,
      requestId: input.requestId,
      ...(input.allowedRoots ? { allowedRoots: input.allowedRoots } : {}),
    })
    return attachments.map((attachment) => attachment.id)
  })
}

function hasAttachmentTransport(
  payload: LocalSessionCommandPayload,
): payload is Extract<
  LocalSessionCommandPayload,
  { contract: 'session-control-v2' | 'session-lifecycle-v2' }
> & { readonly transport: { readonly attachmentPaths: readonly string[] } } {
  return (
    (payload.contract === 'session-control-v2' || payload.contract === 'session-lifecycle-v2') &&
    payload.transport !== undefined
  )
}

function namedProfileAttachmentRoots(
  payload: LocalSessionCommandPayload,
  caller: LocalSessionCallerIdentity,
): Effect.Effect<readonly string[] | undefined, Error> {
  if (!caller.profileAuthority || !hasAttachmentTransport(payload)) {
    return Effect.succeed<readonly string[] | undefined>(undefined)
  }
  const roots = caller.profileAuthority.scope.attachmentRoots ?? []
  return roots.length > 0
    ? Effect.succeed(roots)
    : Effect.fail(
        new Error('Attachment paths require an explicit filesystem attachment-root grant.'),
      )
}

export function prepareSessionCommandAttachments(input: {
  readonly payload: LocalSessionCommandPayload
  readonly caller: LocalSessionCallerIdentity
  readonly workingDirectory?: string
}): Effect.Effect<LocalSessionCommandPayload, Error, SessionControlAttachmentService> {
  const payload = input.payload
  if (!hasAttachmentTransport(payload)) {
    return Effect.succeed(payload)
  }
  const paths = payload.transport.attachmentPaths
  return namedProfileAttachmentRoots(payload, input.caller).pipe(
    Effect.flatMap((allowedRoots) =>
      payload.contract === 'session-control-v2'
        ? prepareControlAttachments({
            ...input,
            payload,
            paths,
            ...(allowedRoots ? { allowedRoots } : {}),
          })
        : prepareLifecycleAttachments({
            ...input,
            payload,
            paths,
            ...(allowedRoots ? { allowedRoots } : {}),
          }),
    ),
  )
}

function prepareControlAttachments(input: {
  readonly payload: Extract<LocalSessionCommandPayload, { contract: 'session-control-v2' }>
  readonly caller: LocalSessionCallerIdentity
  readonly paths: readonly string[]
  readonly workingDirectory?: string
  readonly allowedRoots?: readonly string[]
}): Effect.Effect<LocalSessionCommandPayload, Error, SessionControlAttachmentService> {
  const { payload, paths } = input
  const command = payload.request.command
  if (!isAttachmentControlCommand(command)) {
    return Effect.fail(new Error(`${command.operation} does not accept attachment paths.`))
  }
  if (command.input.attachmentIds.length > 0) {
    return Effect.fail(new Error('Use attachment paths or prepared attachment IDs, not both.'))
  }
  if (paths.length === 0)
    return Effect.succeed({ contract: payload.contract, request: payload.request })
  if (!input.workingDirectory) {
    return Effect.fail(new Error('Attachment paths require a caller working directory.'))
  }
  return preparePaths({
    baseDirectory: input.workingDirectory,
    paths,
    ownerCallerId: input.caller.callerId,
    requestId: `${command.sessionId}\0${payload.request.idempotencyKey}`,
    ...(input.allowedRoots ? { allowedRoots: input.allowedRoots } : {}),
  }).pipe(
    Effect.map(
      (attachmentIds) =>
        ({
          contract: payload.contract,
          request: {
            ...payload.request,
            command: { ...command, input: { ...command.input, attachmentIds } },
          },
        }) satisfies LocalSessionCommandPayload,
    ),
  )
}

function prepareLifecycleAttachments(input: {
  readonly payload: Extract<LocalSessionCommandPayload, { contract: 'session-lifecycle-v2' }>
  readonly caller: LocalSessionCallerIdentity
  readonly paths: readonly string[]
  readonly workingDirectory?: string
  readonly allowedRoots?: readonly string[]
}): Effect.Effect<LocalSessionCommandPayload, Error, SessionControlAttachmentService> {
  const { payload, paths } = input
  const command = payload.request.command
  if (command.operation !== 'launch' && command.operation !== 'spawn') {
    return Effect.fail(new Error(`${command.operation} does not accept attachment paths.`))
  }
  if ((command.attachmentIds ?? []).length > 0) {
    return Effect.fail(new Error('Use attachment paths or prepared attachment IDs, not both.'))
  }
  if (paths.length === 0)
    return Effect.succeed({ contract: payload.contract, request: payload.request })
  if (!input.workingDirectory) {
    return Effect.fail(new Error('Attachment paths require a caller working directory.'))
  }
  return preparePaths({
    baseDirectory: input.workingDirectory,
    paths,
    ownerCallerId: input.caller.callerId,
    requestId: `${command.operation}\0${
      command.operation === 'spawn' ? command.parentSessionId : command.projectPath
    }\0${payload.request.idempotencyKey}`,
    ...(input.allowedRoots ? { allowedRoots: input.allowedRoots } : {}),
  }).pipe(
    Effect.map(
      (attachmentIds) =>
        ({
          contract: payload.contract,
          request: { ...payload.request, command: { ...command, attachmentIds } },
        }) satisfies LocalSessionCommandPayload,
    ),
  )
}
