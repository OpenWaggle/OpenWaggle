import { Schema, type SchemaType } from '@shared/schema'
import { Option } from 'effect'

const checkedByReader = Schema.optionalWith(Schema.Unknown, { exact: true })

/**
 * The fields of a server entry in a file the old OpenWaggle MCP code read, which the migration
 * reads. Their values stay unknown here: these files were written by hand and by other tools, so
 * each reader checks the field it uses and treats one of the wrong shape as the old code did.
 */
const legacyServerFieldsSchema = Schema.Struct({
  command: checkedByReader,
  args: checkedByReader,
  url: checkedByReader,
  cwd: checkedByReader,
  env: checkedByReader,
  environment: checkedByReader,
  headers: checkedByReader,
  http_headers: checkedByReader,
  bearer_token_env_var: checkedByReader,
  transport: checkedByReader,
  type: checkedByReader,
  compatibility: checkedByReader,
  directTools: checkedByReader,
  protocolVersion: checkedByReader,
  required: checkedByReader,
  enabled: checkedByReader,
})

export type LegacyServerFields = SchemaType<typeof legacyServerFieldsSchema>

const decodeFields = Schema.decodeUnknownOption(legacyServerFieldsSchema)

/** The entry's fields, or undefined when the entry is not an object. */
export function legacyServerFields(entry: unknown): LegacyServerFields | undefined {
  return Option.getOrUndefined(decodeFields(entry))
}
