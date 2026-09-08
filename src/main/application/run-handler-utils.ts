import { ATTACHMENT, BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import type { HydratedAgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { buildDeterministicTitle } from '../agent/title-generator'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { hydrateAttachmentSources } from '../utils/attachment-hydration'

const MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE

function validatePreparedAttachments(attachments: readonly PreparedAttachment[]) {
  if (attachments.length > ATTACHMENT.MAX_COUNT) {
    throw new Error(
      `A maximum of ${String(ATTACHMENT.MAX_COUNT)} attachments is supported per message.`,
    )
  }

  const capabilityIds = new Set<string>()
  let totalSizeBytes = 0
  for (const attachment of attachments) {
    if (capabilityIds.has(attachment.id)) {
      throw new Error(`Duplicate prepared attachment capability: ${attachment.name}`)
    }
    capabilityIds.add(attachment.id)
    if (
      !Number.isSafeInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 0 ||
      attachment.sizeBytes > ATTACHMENT.MAX_SIZE_BYTES
    ) {
      throw new Error(
        `Attachment exceeds ${String(ATTACHMENT.MAX_SIZE_BYTES / MEBIBYTE)} MB: ${attachment.name}`,
      )
    }
    if (totalSizeBytes > ATTACHMENT.MAX_TOTAL_SIZE_BYTES - attachment.sizeBytes) {
      throw new Error(
        `Total attachment size exceeds ${String(ATTACHMENT.MAX_TOTAL_SIZE_BYTES / MEBIBYTE)} MB.`,
      )
    }
    totalSizeBytes += attachment.sizeBytes
  }
}

/** Hydrate attachment binary sources from prepared attachment records. */
export async function hydratePayloadAttachments(
  attachments: readonly PreparedAttachment[],
): Promise<HydratedAgentSendPayload['attachments']> {
  validatePreparedAttachments(attachments)
  return hydrateAttachmentSources(attachments)
}

/** Persist a deterministic name for a new projected session from the first user message. */
export function assignSessionTitleFromUserText(
  sessionId: SessionId,
  session: SessionDetail,
  text: string,
) {
  return Effect.gen(function* () {
    if (session.title !== 'New session' || session.messages.length > 0) {
      return null
    }

    const trimmed = text.trim()
    if (!trimmed) {
      return null
    }

    const title = buildDeterministicTitle(trimmed)
    const repo = yield* SessionProjectionRepository
    yield* repo.updateTitle(sessionId, title)
    return title
  })
}
