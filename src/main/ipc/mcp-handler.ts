import { Schema, safeDecodeUnknown } from '@shared/schema'
import { mcpServerDefinitionSchema } from '@shared/schemas/mcp'
import { MCP_CONFIG_SOURCE_IDS } from '@shared/types/mcp'
import * as Effect from 'effect/Effect'
import { authorizeMcpServer, logoutMcpOAuth } from '../adapters/mcp/oauth-provider'
import {
  reconcileMcpRuntimeSettings,
  withMcpRuntimeSettings,
} from '../application/mcp-runtime-settings'
import { openExternal } from '../desktop-ui'
import { createLogger } from '../logger'
import { McpConfigService } from '../ports/mcp-config-service'
import { McpRuntimeService } from '../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../ports/mcp-secret-vault-service'
import { registerMcpCapabilityHandlers } from './mcp-capability-handler'
import { validateProjectPath, validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const logger = createLogger('ipc-mcp')

const projectAndSessionSchema = {
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
}

const getSettingsSchema = Schema.Struct(projectAndSessionSchema)

const setScopeStateSchema = Schema.Struct({
  ...projectAndSessionSchema,
  scope: Schema.Literal('global', 'project', 'session'),
  state: Schema.Literal('inherit', 'on', 'off'),
})

const setServerEnabledSchema = Schema.Struct({
  ...projectAndSessionSchema,
  instanceId: Schema.String,
  enabled: Schema.Boolean,
})

const setProjectServerEnabledSchema = Schema.Struct({
  ...projectAndSessionSchema,
  instanceId: Schema.String,
  enabled: Schema.Boolean,
})

const serverPermissionGrantSchema = Schema.Struct({
  readRoots: Schema.mutable(Schema.Array(Schema.String)),
  writeRoots: Schema.mutable(Schema.Array(Schema.String)),
  allowNetwork: Schema.Boolean,
})

const setServerTrustSchema = Schema.Struct({
  ...projectAndSessionSchema,
  instanceId: Schema.String,
  trusted: Schema.Boolean,
  allowUnsandboxed: Schema.optional(Schema.Boolean),
  permissions: Schema.optional(serverPermissionGrantSchema),
})

const writeSourceConfigSchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sourceId: Schema.Literal(...MCP_CONFIG_SOURCE_IDS),
  rawJson: Schema.String,
})

const removeServerSchema = Schema.Struct({
  ...projectAndSessionSchema,
  instanceId: Schema.String,
})

const importSourceSchema = Schema.Literal(
  'codex',
  'claude-code',
  'claude-desktop',
  'opencode',
  'pi',
  'vscode',
  'cursor',
  'windsurf',
  'zed',
)

const importPreviewSchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sources: Schema.optional(Schema.mutable(Schema.Array(importSourceSchema))),
})

const importApplySchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sources: Schema.optional(Schema.mutable(Schema.Array(importSourceSchema))),
  fingerprints: Schema.mutable(Schema.Array(Schema.String)),
  target: Schema.Literal('global', 'project'),
  conflictPolicy: Schema.Literal('skip', 'replace', 'rename'),
})

const addServerSchema = Schema.Struct({
  ...projectAndSessionSchema,
  name: Schema.String,
  definition: mcpServerDefinitionSchema,
  target: Schema.Literal('global', 'project'),
  replace: Schema.optional(Schema.Boolean),
})

const setSecretSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
})

const removeSecretSchema = Schema.Struct({ name: Schema.String })

function decodeInput<A, I>(schema: Schema.Schema<A, I>, raw: unknown, action: string) {
  const decoded = safeDecodeUnknown(schema, raw)
  if (decoded.success) return Effect.succeed(decoded.data)

  const error = decoded.issues.join('; ')
  logger.warn(`Invalid MCP ${action} payload`, { error })
  return Effect.fail(new Error(error))
}

function validateInputProjectPath<A extends { readonly projectPath?: string | null }>(input: A) {
  return validateProjectPath(input.projectPath).pipe(
    Effect.map((projectPath) => ({ ...input, projectPath })),
  )
}

function registerMcpConfigHandlers() {
  typedHandle('mcp:get-settings', (_event, raw = {}) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(getSettingsSchema, raw, 'settings read')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const view = yield* service.getView(input)
      return yield* withMcpRuntimeSettings(view)
    }),
  )

  typedHandle('mcp:set-scope-state', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(setScopeStateSchema, raw, 'scope toggle')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const view = yield* service.setScopeState(input)
      return yield* reconcileMcpRuntimeSettings(view)
    }),
  )

  typedHandle('mcp:set-server-enabled', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(setServerEnabledSchema, raw, 'server toggle')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const view = yield* service.setServerEnabled(input)
      return yield* reconcileMcpRuntimeSettings(view)
    }),
  )

  typedHandle('mcp:set-project-server-enabled', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(
        setProjectServerEnabledSchema,
        raw,
        'project server toggle',
      )
      const projectPath = yield* validateRequiredProjectPath(decoded.projectPath)
      const service = yield* McpConfigService
      const view = yield* service.setProjectServerEnabled({ ...decoded, projectPath })
      return yield* reconcileMcpRuntimeSettings(view)
    }),
  )

  typedHandle('mcp:set-server-trust', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(setServerTrustSchema, raw, 'server trust')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const view = yield* service.setServerTrust(input)
      return yield* reconcileMcpRuntimeSettings(view)
    }),
  )

  typedHandle('mcp:write-source-config', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(writeSourceConfigSchema, raw, 'source write')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const view = yield* service.writeSourceConfig(input)
      return yield* reconcileMcpRuntimeSettings(view)
    }),
  )

  typedHandle('mcp:remove-server', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(removeServerSchema, raw, 'server removal')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const view = yield* service.removeServer(input)
      return yield* reconcileMcpRuntimeSettings(view)
    }),
  )
}

function registerMcpAuthorizationHandlers() {
  typedHandle('mcp:authorize-server', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(removeServerSchema, raw, 'server authorization')
      const input = yield* validateInputProjectPath(decoded)
      const config = yield* McpConfigService
      const server = yield* config.getServerDefinition(input)
      const vault = yield* McpSecretVaultService
      return yield* Effect.tryPromise({
        try: () =>
          authorizeMcpServer({
            ...server,
            vault: {
              resolve: (name) => Effect.runPromise(vault.resolve(name)),
              set: (name, value) => Effect.runPromise(vault.set({ name, value })),
              remove: (name) => Effect.runPromise(vault.remove({ name })),
            },
            openExternal,
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    }),
  )

  typedHandle('mcp:logout-server', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(removeServerSchema, raw, 'server logout')
      const input = yield* validateInputProjectPath(decoded)
      const config = yield* McpConfigService
      const server = yield* config.getServerDefinition(input)
      const vault = yield* McpSecretVaultService
      yield* Effect.tryPromise({
        try: () =>
          logoutMcpOAuth({
            instanceId: server.instanceId,
            vault: {
              resolve: (name) => Effect.runPromise(vault.resolve(name)),
              set: (name, value) => Effect.runPromise(vault.set({ name, value })),
              remove: (name) => Effect.runPromise(vault.remove({ name })),
            },
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      return { loggedOut: true }
    }),
  )
}

function registerMcpDiscoveryHandlers() {
  typedHandle('mcp:add-server', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(addServerSchema, raw, 'server add')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const view = yield* service.addServer(input)
      return yield* reconcileMcpRuntimeSettings(view)
    }),
  )

  typedHandle('mcp:preview-imports', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(importPreviewSchema, raw, 'import preview')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      return yield* service.previewImports(input)
    }),
  )

  typedHandle('mcp:apply-imports', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(importApplySchema, raw, 'import apply')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpConfigService
      const result = yield* service.applyImports(input)
      const view = yield* reconcileMcpRuntimeSettings(result.view)
      return { ...result, view }
    }),
  )

  typedHandle('mcp:doctor', (_event, raw = {}) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(getSettingsSchema, raw, 'doctor')
      const input = yield* validateInputProjectPath(decoded)
      const service = yield* McpRuntimeService
      return yield* service.doctor(input)
    }),
  )
}

function registerMcpSecretHandlers() {
  typedHandle('mcp:list-secrets', () =>
    Effect.gen(function* () {
      const service = yield* McpSecretVaultService
      return yield* service.list()
    }),
  )

  typedHandle('mcp:set-secret', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const input = yield* decodeInput(setSecretSchema, raw, 'secret write')
      const service = yield* McpSecretVaultService
      return yield* service.set(input)
    }),
  )

  typedHandle('mcp:remove-secret', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const input = yield* decodeInput(removeSecretSchema, raw, 'secret removal')
      const service = yield* McpSecretVaultService
      return yield* service.remove(input)
    }),
  )
}

export function registerMcpHandlers(): void {
  registerMcpConfigHandlers()
  registerMcpAuthorizationHandlers()
  registerMcpDiscoveryHandlers()
  registerMcpSecretHandlers()
  registerMcpCapabilityHandlers()
}
