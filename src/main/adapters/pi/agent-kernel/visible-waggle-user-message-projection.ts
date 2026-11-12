import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { safeDecodeUnknown } from '@shared/schema'
import { waggleInvocationMetadataSchema } from '@shared/schemas/waggle'
import { toJsonValue } from '../pi-message-mapper'
import type { PiEntryProjection } from './entry-projections'
import {
  buildMessageNodeContentJson,
  buildRawNodeContentJson,
  piTextAndImageContentToParts,
} from './message-parts'
import { decodeUserInputProjection } from './user-input-projection'

type VisibleWaggleUserEntry = Pick<
  Extract<SessionEntry, { type: 'custom_message' }>,
  'customType' | 'content' | 'display' | 'details'
>

/** The display parts and invocation a visible Waggle user request shows in the transcript. */
export function visibleWaggleUserMessageDisplay(entry: VisibleWaggleUserEntry) {
  const details = toJsonValue(entry.details ?? null)
  const detailsRecord =
    typeof details === 'object' && details !== null && !Array.isArray(details) ? details : null
  const decodedInvocation = detailsRecord
    ? safeDecodeUnknown(waggleInvocationMetadataSchema, detailsRecord.waggleInvocation)
    : null
  const displayParts = detailsRecord ? decodeUserInputProjection(detailsRecord.userInput) : null
  return {
    details,
    parts: displayParts ?? piTextAndImageContentToParts(entry.content),
    waggleInvocation: decodedInvocation?.success ? decodedInvocation.data : null,
  }
}

export function visibleWaggleUserMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
  const display = visibleWaggleUserMessageDisplay(entry)
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(display.parts, null),
    metadataJson: buildRawNodeContentJson(
      display.waggleInvocation
        ? { waggleInvocation: display.waggleInvocation }
        : {
            customType: entry.customType,
            display: entry.display,
            details: display.details,
          },
    ),
  }
}
