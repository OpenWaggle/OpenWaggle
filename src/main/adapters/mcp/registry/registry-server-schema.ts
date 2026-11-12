import { Schema, type SchemaType } from '@shared/schema'
import {
  lenientArray,
  lenientOptional,
  lenientRecord,
  nonBlankStringSchema,
} from '@shared/schemas/lenient'

/**
 * The parts of an MCP Registry `server.json` the installer reads. The Registry is a public
 * service other publishers write to, so a field of the wrong type reads as absent, as it always
 * did here; the installer then refuses what it cannot run. Text fields read as absent when blank.
 */

const text = lenientOptional(nonBlankStringSchema)
const flag = lenientOptional(Schema.Boolean)

const registryVariableSchema = Schema.Struct({
  value: text,
  default: text,
  isRequired: flag,
  isSecret: flag,
})

/** A server.json `Input`, `KeyValueInput` or `Argument`. */
export const registryInputSchema = Schema.Struct({
  name: text,
  valueHint: text,
  value: text,
  default: text,
  type: lenientOptional(Schema.String),
  format: lenientOptional(Schema.String),
  isRequired: flag,
  isSecret: flag,
  variables: lenientOptional(lenientRecord(registryVariableSchema)),
})

export type RegistryInput = SchemaType<typeof registryInputSchema>

/** A list of inputs; an entry that is not an object is skipped. */
export const registryInputListSchema = lenientArray(registryInputSchema)

export type RegistryInputList = SchemaType<typeof registryInputListSchema>

export const registryPackageSchema = Schema.Struct({
  identifier: text,
  version: text,
  registryType: lenientOptional(Schema.String),
  registryBaseUrl: text,
  runtimeHint: text,
  fileSha256: text,
  transport: lenientOptional(Schema.Struct({ type: lenientOptional(Schema.String) })),
  runtimeArguments: registryInputListSchema,
  packageArguments: registryInputListSchema,
  environmentVariables: registryInputListSchema,
})

export type RegistryPackage = SchemaType<typeof registryPackageSchema>

const registryRemoteSchema = Schema.Struct({
  url: text,
  type: lenientOptional(Schema.Literal('sse', 'streamable-http')),
  headers: registryInputListSchema,
})

export const registryServerSchema = Schema.Struct({
  name: text,
  version: text,
  title: text,
  description: text,
  repository: lenientOptional(Schema.Struct({ url: text })),
  remotes: lenientArray(registryRemoteSchema),
  packages: lenientArray(registryPackageSchema),
})

export type RegistryServer = SchemaType<typeof registryServerSchema>

/**
 * One entry of a Registry server list: the server, wrapped in `server` with the Registry's
 * `_meta` beside it, or bare as older registries answer.
 */
export const registryListEntrySchema = Schema.Struct({
  server: Schema.optional(Schema.Unknown),
  _meta: lenientOptional(
    Schema.Struct({
      'io.modelcontextprotocol.registry/official': lenientOptional(
        Schema.Struct({ isLatest: flag }),
      ),
    }),
  ),
})

export const registryServerListSchema = Schema.Struct({ servers: Schema.Array(Schema.Unknown) })
