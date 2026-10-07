import { Schema } from '@shared/schema'
import { MCP_CONFIG_FILE_ID_VALUES, MCP_EXPOSURE_VALUES } from '@shared/types/mcp-configuration'
import {
  MCP_IMPORT_SOURCE_IDS,
  type McpAddServerRequest,
  type McpConfigurationScopeRequest,
  type McpImportApplyRequest,
  type McpImportPreviewRequest,
  type McpInstallCatalogServerRequest,
  type McpServerRequest,
  type McpSetServerEnabledRequest,
  type McpSetServerExposureRequest,
} from '@shared/types/mcp-configuration-operations'
import { mcpConfigValueSchema } from './mcp'

/**
 * Inputs of the Settings > MCP and `openwaggle mcp` operations. A Pi entry is decoded as a JSON
 * record, never as a Struct: a Struct drops undeclared keys, and Pi entries carry fields
 * (`oauth`, `timeout`, `cwd`, …) that OpenWaggle does not list. The adapter validates the entry
 * the way Pi does.
 */

const MAX_PATH_LENGTH = 4096
const MAX_NAME_LENGTH = 256
const MAX_FINGERPRINTS = 500

const nonEmpty = (maxLength: number) =>
  Schema.String.pipe(Schema.minLength(1), Schema.maxLength(maxLength))

const projectPath = Schema.NullOr(nonEmpty(MAX_PATH_LENGTH))
const serverName = nonEmpty(MAX_NAME_LENGTH)
const exposure = Schema.Literal(...MCP_EXPOSURE_VALUES)
const destination = Schema.Literal(...MCP_CONFIG_FILE_ID_VALUES)
const scope = Schema.Literal('global', 'project')
const importSource = Schema.Literal(...MCP_IMPORT_SOURCE_IDS)

export const mcpConfigurationScopeRequestSchema: Schema.Schema<McpConfigurationScopeRequest> =
  Schema.Struct({ projectPath })

export const mcpServerRequestSchema: Schema.Schema<McpServerRequest> = Schema.Struct({
  projectPath,
  name: serverName,
})

export const mcpSetServerEnabledRequestSchema: Schema.Schema<McpSetServerEnabledRequest> =
  Schema.Struct({
    projectPath,
    name: serverName,
    enabled: Schema.Boolean,
    target: Schema.Literal('server', 'project'),
    destination: Schema.optional(destination),
  })

export const mcpSetServerExposureRequestSchema: Schema.Schema<McpSetServerExposureRequest> =
  Schema.Struct({
    projectPath,
    name: serverName,
    exposure: Schema.optional(exposure),
    toolExposure: Schema.optional(
      Schema.Record({ key: nonEmpty(MAX_NAME_LENGTH), value: Schema.NullOr(exposure) }),
    ),
  }).pipe(
    Schema.filter((input) =>
      input.exposure !== undefined || input.toolExposure !== undefined
        ? undefined
        : 'Set the server exposure, a tool exposure, or both.',
    ),
  )

export const mcpAddServerRequestSchema: Schema.Schema<McpAddServerRequest> = Schema.Struct({
  projectPath,
  name: serverName,
  scope,
  destination: Schema.optional(destination),
  entry: Schema.Record({ key: Schema.String, value: mcpConfigValueSchema }),
})

export const mcpInstallCatalogServerRequestSchema: Schema.Schema<McpInstallCatalogServerRequest> =
  Schema.Struct({
    projectPath,
    catalogName: serverName,
    scope,
    destination: Schema.optional(destination),
  })

export const mcpImportPreviewRequestSchema: Schema.Schema<McpImportPreviewRequest> = Schema.Struct({
  projectPath,
  sources: Schema.optional(Schema.Array(importSource)),
})

export const mcpImportApplyRequestSchema: Schema.Schema<McpImportApplyRequest> = Schema.Struct({
  projectPath,
  sources: Schema.optional(Schema.Array(importSource)),
  fingerprints: Schema.Array(nonEmpty(MAX_NAME_LENGTH)).pipe(Schema.maxItems(MAX_FINGERPRINTS)),
  target: scope,
  conflictPolicy: Schema.Literal('skip', 'replace', 'rename'),
})
