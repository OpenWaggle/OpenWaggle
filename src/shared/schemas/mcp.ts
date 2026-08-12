import { Schema } from '@shared/schema'
import type {
  McpConfigArray,
  McpConfigCredentialValue,
  McpConfigValue,
  McpServerClientCapabilitiesConfig,
  McpServerOAuthConfig,
  McpServerProvenance,
  McpServerSecurityConfig,
} from '@shared/types/mcp'

const mcpConfigArraySchema: Schema.Schema<McpConfigArray> = Schema.mutable(
  Schema.Array(Schema.suspend(() => mcpConfigValueSchema)),
)

const mcpConfigObjectRestSchema = Schema.Record({
  key: Schema.String,
  value: Schema.suspend(() => mcpConfigValueSchema),
})

const mcpConfigObjectSchema = Schema.mutable(mcpConfigObjectRestSchema)

export const mcpConfigValueSchema: Schema.Schema<McpConfigValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    mcpConfigArraySchema,
    mcpConfigObjectSchema,
  ),
)

const mcpSecretReferenceSchema = Schema.Struct({ secret: Schema.String }, mcpConfigObjectRestSchema)

const mcpCredentialValueSchema: Schema.Schema<McpConfigCredentialValue> = Schema.Union(
  Schema.String,
  mcpSecretReferenceSchema,
)

const mcpCredentialMapSchema = Schema.mutable(
  Schema.Record({ key: Schema.String, value: mcpCredentialValueSchema }),
)

const mcpDirectToolsSchema = Schema.Union(
  Schema.Boolean,
  Schema.mutable(Schema.Array(Schema.String)),
)

const mcpSecuritySchema: Schema.Schema<McpServerSecurityConfig> = Schema.Struct(
  {
    allowUnsandboxed: Schema.optional(Schema.Boolean),
    allowNetwork: Schema.optional(Schema.Boolean),
    allowInsecurePrivateNetwork: Schema.optional(Schema.Boolean),
    readRoots: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    writeRoots: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    networkDomains: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    oauthDomains: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  },
  mcpConfigObjectRestSchema,
)

const mcpOAuthSchema: Schema.Schema<McpServerOAuthConfig> = Schema.Struct(
  {
    type: Schema.Literal('oauth'),
    scopes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    clientMetadataUrl: Schema.optional(Schema.String),
  },
  mcpConfigObjectRestSchema,
)

const mcpClientCapabilitiesSchema: Schema.Schema<McpServerClientCapabilitiesConfig> = Schema.Struct(
  {
    elicitation: Schema.optional(
      Schema.Union(Schema.Literal(false), Schema.Literal('form', 'form-and-url')),
    ),
    sampling: Schema.optional(Schema.Boolean),
    roots: Schema.optional(Schema.Boolean),
    loggingLevel: Schema.optional(
      Schema.Literal(
        'off',
        'debug',
        'info',
        'notice',
        'warning',
        'error',
        'critical',
        'alert',
        'emergency',
      ),
    ),
    remoteSkills: Schema.optional(Schema.Boolean),
  },
  mcpConfigObjectRestSchema,
)

const mcpProvenanceSchema: Schema.Schema<McpServerProvenance> = Schema.Struct(
  {
    source: Schema.Literal(
      'codex',
      'claude-code',
      'claude-desktop',
      'opencode',
      'pi',
      'vscode',
      'cursor',
      'windsurf',
      'zed',
      'registry',
      'manual',
    ),
    sourcePath: Schema.optional(Schema.String),
    fingerprint: Schema.optional(Schema.String),
    importedAt: Schema.optional(Schema.String),
    registryName: Schema.optional(Schema.String),
    registryVersion: Schema.optional(Schema.String),
    packageCoordinate: Schema.optional(Schema.String),
    packageDigest: Schema.optional(Schema.String),
  },
  mcpConfigObjectRestSchema,
)

export const mcpServerDefinitionSchema = Schema.Struct(
  {
    command: Schema.optional(Schema.String),
    args: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    cwd: Schema.optional(Schema.String),
    env: Schema.optional(mcpCredentialMapSchema),
    url: Schema.optional(Schema.String),
    headers: Schema.optional(mcpCredentialMapSchema),
    transport: Schema.optional(
      Schema.Literal('stdio', 'streamable-http', 'sse', 'websocket', 'unknown'),
    ),
    compatibility: Schema.optional(
      Schema.Literal(
        'auto',
        'modern-only',
        'legacy-stateful-http',
        'legacy-sse',
        'legacy-websocket',
      ),
    ),
    protocolVersion: Schema.optional(Schema.String),
    directTools: Schema.optional(mcpDirectToolsSchema),
    required: Schema.optional(Schema.Boolean),
    security: Schema.optional(mcpSecuritySchema),
    auth: Schema.optional(mcpOAuthSchema),
    clientCapabilities: Schema.optional(mcpClientCapabilitiesSchema),
    provenance: Schema.optional(mcpProvenanceSchema),
  },
  mcpConfigObjectRestSchema,
)

export const mcpServerMapSchema = Schema.mutable(
  Schema.Record({ key: Schema.String, value: mcpServerDefinitionSchema }),
)

const mcpOpenWaggleConfigSchema = Schema.Struct(
  {
    state: Schema.optional(Schema.Literal('inherit', 'on', 'off')),
  },
  mcpConfigObjectRestSchema,
)

export const mcpConfigFileSchema = Schema.Struct(
  {
    mcpServers: Schema.optional(mcpServerMapSchema),
    servers: Schema.optional(mcpServerMapSchema),
    openwaggle: Schema.optional(mcpOpenWaggleConfigSchema),
  },
  mcpConfigObjectRestSchema,
)
