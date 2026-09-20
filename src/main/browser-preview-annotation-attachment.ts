import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { BrowserPreviewAttachmentMetadata, PreparedAttachment } from '@shared/types/agent'
import * as Effect from 'effect/Effect'

export interface BrowserPreviewAnnotationAttachmentInput {
  readonly path: string
  readonly origin: 'browser-preview'
  readonly browserPreview: BrowserPreviewAttachmentMetadata
  readonly browserAnnotationText: string
}

/** Native screenshots become sendable only after the Host commits their capability. */
export async function prepareBrowserPreviewAnnotationAttachment(
  entry: BrowserPreviewAnnotationAttachmentInput,
): Promise<PreparedAttachment> {
  const { dispatchConfiguredGuiSessionCommand } = await import(
    './application/gui-session-command-router'
  )
  const requestId = randomUUID()
  const remote = dispatchConfiguredGuiSessionCommand({
    caller: { callerId: 'gui:local-user', workingDirectory: path.dirname(entry.path) },
    payload: { contract: 'local-attachments-v1', request: { requestId, entries: [entry] } },
  })
  if (!remote) throw new Error('Browser annotation preparation requires the attached Session Host.')
  const result = await Effect.runPromise(remote)
  if (result.contract !== 'local-attachments-v1' || result.response.requestId !== requestId) {
    throw new Error('Session Host returned an invalid browser annotation preparation response.')
  }
  const attachment = result.response.attachments[0]
  if (
    result.response.attachments.length !== 1 ||
    !attachment ||
    attachment.kind !== 'image' ||
    attachment.origin !== 'browser-preview' ||
    attachment.path !== entry.path
  ) {
    throw new Error('Session Host did not prepare the requested browser annotation screenshot.')
  }
  return attachment
}
