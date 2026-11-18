import { randomUUID } from 'node:crypto'
import type { AttachmentOrigin } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { dispatchGuiSessionCommand } from '../application/gui-session-command'
import { rememberPreparedAttachment } from '../utils/attachment-registry'

/**
 * Asks the Session Host to prepare attachment files. The Host binds a message only to the
 * attachments it prepared itself, so this is the one way an attachment becomes sendable: an
 * attachment the window builds on its own attaches and then fails the send with "Attachment
 * capability was not found".
 */
export function dispatchHostAttachmentPreparation(
  baseDirectory: string,
  entries: readonly { readonly path: string; readonly origin?: AttachmentOrigin }[],
) {
  return Effect.gen(function* () {
    const result = yield* dispatchGuiSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: baseDirectory },
      payload: {
        contract: 'local-attachments-v1',
        request: { requestId: randomUUID(), entries },
      },
    })
    if (result.contract !== 'local-attachments-v1') {
      return yield* Effect.fail(new Error('Session Host rejected attachment preparation.'))
    }
    return [...result.response.attachments]
  })
}

/** Prepares files through the Host and records each one as this window's capability. */
export function prepareAttachmentsThroughHost(
  baseDirectory: string,
  entries: readonly { readonly path: string; readonly origin?: AttachmentOrigin }[],
) {
  return Effect.gen(function* () {
    const attachments = yield* dispatchHostAttachmentPreparation(baseDirectory, entries)
    for (const attachment of attachments) {
      yield* Effect.promise(() => rememberPreparedAttachment(attachment, attachment.path))
    }
    return attachments
  })
}
