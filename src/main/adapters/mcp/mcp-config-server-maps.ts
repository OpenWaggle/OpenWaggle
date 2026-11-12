import { Schema, type SchemaType } from '@shared/schema'
import { lenientOptional } from '@shared/schemas/lenient'
import { jsonValueSchema } from '@shared/schemas/validation'
import { Option } from 'effect'

/**
 * The server maps of a parsed MCP config file: Pi's `mcpServers`, and the `servers` alias old
 * OpenWaggle files used. Each is keyed by server name; the entries are JSON that the reader of
 * each entry decodes. A map that is not an object reads as absent, as the readers always did.
 */
const serverMapSchema = Schema.Record({ key: Schema.String, value: jsonValueSchema })

const configServerMapsSchema = Schema.Struct({
  mcpServers: lenientOptional(serverMapSchema),
  servers: lenientOptional(serverMapSchema),
})

export type McpConfigServerMaps = SchemaType<typeof configServerMapsSchema>

const decodeServerMaps = Schema.decodeUnknownOption(configServerMapsSchema)

/** The server maps of a parsed config; a config that is not an object has none. */
export function mcpConfigServerMaps(config: unknown): McpConfigServerMaps {
  return Option.getOrElse(decodeServerMaps(config), () => ({}))
}

const mcpServersFieldSchema = Schema.Struct({ mcpServers: Schema.optional(Schema.Unknown) })
const decodeMcpServersField = Schema.decodeUnknownOption(mcpServersFieldSchema)

/**
 * A parsed config's `mcpServers` as written, whatever its shape, for readers that refuse one that
 * is not an object; undefined when the config is not an object or has none.
 */
export function writtenMcpServers(config: unknown): unknown {
  return Option.getOrUndefined(decodeMcpServersField(config))?.mcpServers
}
