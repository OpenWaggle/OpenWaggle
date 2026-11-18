import { Schema } from '@shared/schema'
import { MCP_EXPOSURE_VALUES } from '@shared/types/mcp-configuration'
import { MCP_REGISTRY_PACKAGE_TYPES } from '@shared/types/mcp-registry'

/** Inputs of the MCP Registry search, lookup, and install operations, decoded at the Host. */

const MAX_PATH_LENGTH = 4096
const MAX_NAME_LENGTH = 256
const MAX_QUERY_LENGTH = 200
const MAX_URL_LENGTH = 2048
const MAX_RESULT_LIMIT = 100

const nonEmpty = (maxLength: number) =>
  Schema.String.pipe(Schema.minLength(1), Schema.maxLength(maxLength))

const registryUrl = Schema.optionalWith(nonEmpty(MAX_URL_LENGTH), { exact: true })
const registryName = nonEmpty(MAX_NAME_LENGTH)
const version = Schema.optionalWith(nonEmpty(MAX_NAME_LENGTH), { exact: true })

export const mcpRegistrySearchRequestSchema = Schema.Struct({
  query: Schema.String.pipe(Schema.maxLength(MAX_QUERY_LENGTH)),
  limit: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(1, MAX_RESULT_LIMIT)),
    { exact: true },
  ),
  /** Another registry with the same API; HTTPS, or an explicit loopback URL. */
  registryUrl,
})

export const mcpRegistryServerRequestSchema = Schema.Struct({
  registryName,
  /** Exact version; the latest when omitted. */
  version,
  registryUrl,
})

export const mcpRegistryInstallRequestSchema = Schema.Struct({
  /** The OpenWaggle project root; null changes only the global files. */
  projectPath: Schema.NullOr(nonEmpty(MAX_PATH_LENGTH)),
  registryName,
  version,
  registryUrl,
  scope: Schema.Literal('global', 'project'),
  /** Defaults to the hosted URL when there is one, else the first supported package. */
  method: Schema.optionalWith(Schema.Literal('remote', ...MCP_REGISTRY_PACKAGE_TYPES), {
    exact: true,
  }),
  /** Defaults to the server's `suggestedName`. */
  serverName: Schema.optionalWith(nonEmpty(MAX_NAME_LENGTH), { exact: true }),
  exposure: Schema.optionalWith(Schema.Literal(...MCP_EXPOSURE_VALUES), { exact: true }),
})
