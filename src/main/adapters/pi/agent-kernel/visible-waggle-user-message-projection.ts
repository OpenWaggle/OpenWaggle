import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { safeDecodeUnknown, Schema } from '@shared/schema'
import { waggleInvocationMetadataSchema } from '@shared/schemas/waggle'
import { Option } from 'effect'
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

/** The `details` fields of a visible Waggle user request; each is decoded where it is used. */
const decodeVisibleWaggleUserDetails = Schema.decodeUnknownOption(
  Schema.Struct({
    waggleInvocation: Schema.optionalWith(Schema.Unknown, { exact: true }),
    userInput: Schema.optionalWith(Schema.Unknown, { exact: true }),
  }),
)

/** The display parts and invocation a visible Waggle user request shows in the transcript. */
export function visibleWaggleUserMessageDisplay(entry: VisibleWaggleUserEntry) {
  const details = toJsonValue(entry.details ?? null)
  const fields = Option.getOrUndefined(decodeVisibleWaggleUserDetails(details))
  const decodedInvocation = fields
    ? safeDecodeUnknown(waggleInvocationMetadataSchema, fields.waggleInvocation)
    : null
  const displayParts = fields ? decodeUserInputProjection(fields.userInput) : null
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
