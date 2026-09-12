import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
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
    command.operation === 'replace'
  ) {
    return command.input.attachmentIds
  }
  return []
}

export function bindSessionControlAttachments(
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
