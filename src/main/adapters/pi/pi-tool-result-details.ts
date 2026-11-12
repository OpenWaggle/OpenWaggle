import { Schema } from '@shared/schema'
import { lenientOptional } from '@shared/schemas/lenient'
import { Option } from 'effect'

/** The fields of a Pi tool result's `details` that projections read; each tool writes the rest. */
const decodeToolResultDetails = Schema.decodeUnknownOption(
  Schema.Struct({
    args: Schema.optional(Schema.Unknown),
    duration: lenientOptional(Schema.Number),
  }),
)

/** The `args` and `duration` of a tool result's `details`, none when it is not an object. */
export function piToolResultDetails(details: unknown): {
  readonly args?: unknown
  readonly duration?: number | undefined
} {
  return Option.getOrElse(decodeToolResultDetails(details), () => ({}))
}
