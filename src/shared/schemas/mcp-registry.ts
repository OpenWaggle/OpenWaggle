import { Schema } from '@shared/schema'
import { MCP_EXPOSURE_VALUES } from '@shared/types/mcp-configuration'
import {
  MCP_REGISTRY_PACKAGE_TYPES,
  type McpRegistryInstallRequest,
  type McpRegistrySearchRequest,
  type McpRegistryServerRequest,
} from '@shared/types/mcp-registry'

/** Inputs of the MCP Registry search, lookup, and install operations, decoded at the Host. */

const MAX_PATH_LENGTH = 4096
const MAX_NAME_LENGTH = 256
const MAX_QUERY_LENGTH = 200
const MAX_URL_LENGTH = 2048
const MAX_RESULT_LIMIT = 100

const nonEmpty = (maxLength: number) =>
  Schema.String.pipe(Schema.minLength(1), Schema.maxLength(maxLength))

const registryUrl = Schema.optional(nonEmpty(MAX_URL_LENGTH))
const registryName = nonEmpty(MAX_NAME_LENGTH)
const version = Schema.optional(nonEmpty(MAX_NAME_LENGTH))

export const mcpRegistrySearchRequestSchema: Schema.Schema<McpRegistrySearchRequest> =
  Schema.Struct({
    query: Schema.String.pipe(Schema.maxLength(MAX_QUERY_LENGTH)),
    limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, MAX_RESULT_LIMIT))),
    registryUrl,
  })

export const mcpRegistryServerRequestSchema: Schema.Schema<McpRegistryServerRequest> =
  Schema.Struct({ registryName, version, registryUrl })

export const mcpRegistryInstallRequestSchema: Schema.Schema<McpRegistryInstallRequest> =
  Schema.Struct({
    projectPath: Schema.NullOr(nonEmpty(MAX_PATH_LENGTH)),
    registryName,
    version,
    registryUrl,
    scope: Schema.Literal('global', 'project'),
    method: Schema.optional(Schema.Literal('remote', ...MCP_REGISTRY_PACKAGE_TYPES)),
    serverName: Schema.optional(nonEmpty(MAX_NAME_LENGTH)),
    exposure: Schema.optional(Schema.Literal(...MCP_EXPOSURE_VALUES)),
  })
