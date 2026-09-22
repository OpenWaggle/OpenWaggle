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

export function visibleWaggleUserMessageProjection(
  entry: Extract<SessionEntry, { type: 'custom_message' }>,
): PiEntryProjection {
  const details = toJsonValue(entry.details ?? null)
  const detailsRecord =
    typeof details === 'object' && details !== null && !Array.isArray(details) ? details : null
  const decodedInvocation = detailsRecord
    ? safeDecodeUnknown(waggleInvocationMetadataSchema, detailsRecord.waggleInvocation)
    : null
  const displayParts = detailsRecord ? decodeUserInputProjection(detailsRecord.userInput) : null
  return {
    kind: 'user_message',
    role: 'user',
    contentJson: buildMessageNodeContentJson(
      displayParts ?? piTextAndImageContentToParts(entry.content),
      null,
    ),
    metadataJson: buildRawNodeContentJson(
      decodedInvocation?.success
        ? { waggleInvocation: decodedInvocation.data }
        : {
            customType: entry.customType,
            display: entry.display,
            details,
          },
    ),
  }
}
