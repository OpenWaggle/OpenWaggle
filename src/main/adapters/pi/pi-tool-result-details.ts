import { Schema, type SchemaType } from '@shared/schema'
import { lenientOptional } from '@shared/schemas/lenient'
import { Option } from 'effect'

/** The fields of a Pi tool result's `details` that projections read; each tool writes the rest. */
// explicit undefined: each tool writes its in-process `details`, and may set a key to undefined
const toolResultDetailsSchema = Schema.Struct({
  args: Schema.optional(Schema.Unknown),
  duration: lenientOptional(Schema.Number),
})
const decodeToolResultDetails = Schema.decodeUnknownOption(toolResultDetailsSchema)

/** The `args` and `duration` of a tool result's `details`, none when it is not an object. */
export function piToolResultDetails(details: unknown): SchemaType<typeof toolResultDetailsSchema> {
  return Option.getOrElse(decodeToolResultDetails(details), () => ({}))
}
