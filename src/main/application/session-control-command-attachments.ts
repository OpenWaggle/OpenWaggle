import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { FollowUpEditHoldRepository } from '../ports/follow-up-edit-hold-repository'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'

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
    command.operation === 'replace' ||
    command.operation === 'queue-edit-save'
  ) {
    return command.input.attachmentIds
  }
  return []
}

/**
 * A Follow-up edit's attachments are retained past a rejected save, so the draft can be saved
 * again or queued as a new message. Optional: a runtime without holds has nothing to retain.
 */
function retainFollowUpEditAttachments(sessionId: string, attachmentIds: readonly string[]) {
  return Effect.serviceOption(FollowUpEditHoldRepository).pipe(
    Effect.flatMap((holds) =>
      Option.isSome(holds)
        ? holds.value.retainAttachments({ sessionId, attachmentIds })
        : Effect.void,
    ),
  )
}

export function bindSessionControlAttachments(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-control-v2' }>,
) {
  const command = payload.request.command
  const attachmentIds = controlAttachmentIds(command)
  if (attachmentIds.length === 0) return Effect.void
  const bind = SessionControlAttachmentService.pipe(
    Effect.flatMap((service) =>
      service.bind({
        attachmentIds,
        sessionId: command.sessionId,
        ownerCallerId: caller.callerId,
      }),
    ),
  )
  return command.operation === 'queue-edit-save'
    ? bind.pipe(Effect.zipRight(retainFollowUpEditAttachments(command.sessionId, attachmentIds)))
    : bind
}
