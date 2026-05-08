import type { HydratedAgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { buildDeterministicTitle } from '../agent/title-generator'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { hydrateAttachmentSources } from '../utils/attachment-hydration'

/** Hydrate attachment binary sources from prepared attachment records. */
export async function hydratePayloadAttachments(
  attachments: readonly PreparedAttachment[],
): Promise<HydratedAgentSendPayload['attachments']> {
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
