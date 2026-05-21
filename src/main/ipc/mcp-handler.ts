import { Schema, safeDecodeUnknown } from '@shared/schema'
import { MCP_CONFIG_SOURCE_IDS } from '@shared/types/mcp'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { McpConfigService } from '../ports/mcp-config-service'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const logger = createLogger('ipc-mcp')

const sourceIdSchema = Schema.Literal(...MCP_CONFIG_SOURCE_IDS)

const setServerEnabledSchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sourceId: sourceIdSchema,
  serverName: Schema.String,
  enabled: Schema.Boolean,
})

const writeSourceConfigSchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sourceId: sourceIdSchema,
  rawJson: Schema.String,
})

function decodeProjectPathArg(value: unknown, action: string) {
  if (typeof value === 'string' || value === null || value === undefined) {
    return Effect.succeed(value)
  }

  const error = 'Project path must be a string, null, or undefined.'
  logger.warn(`Invalid MCP ${action} project path payload`, { error })
  return Effect.fail(new Error(error))
}

export function registerMcpHandlers(): void {
  typedHandle('mcp:get-settings', (_event, projectPath?: string | null) =>
    Effect.gen(function* () {
      const decodedProjectPath = yield* decodeProjectPathArg(projectPath, 'settings read')
      const validatedProjectPath = yield* validateProjectPath(decodedProjectPath)
      const service = yield* McpConfigService
      return yield* service.getView(validatedProjectPath)
    }),
  )

  typedHandle('mcp:set-adapter-enabled', (_event, enabled: boolean, projectPath?: string | null) =>
    Effect.gen(function* () {
      const decodedEnabled = safeDecodeUnknown(Schema.Boolean, enabled)
      if (!decodedEnabled.success) {
        const error = decodedEnabled.issues.join('; ')
        logger.warn('Invalid MCP adapter toggle payload', { error })
        return yield* Effect.fail(new Error(error))
      }
      const decodedProjectPath = yield* decodeProjectPathArg(projectPath, 'adapter toggle')
      const validatedProjectPath = yield* validateProjectPath(decodedProjectPath)
      const service = yield* McpConfigService
      return yield* service.setAdapterEnabled({
        enabled: decodedEnabled.data,
        projectPath: validatedProjectPath,
      })
    }),
  )

  typedHandle('mcp:set-server-enabled', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(setServerEnabledSchema, raw)
      if (!decoded.success) {
        const error = decoded.issues.join('; ')
        logger.warn('Invalid MCP server toggle payload', { error })
        return yield* Effect.fail(new Error(error))
      }
      const validatedProjectPath = yield* validateProjectPath(decoded.data.projectPath)
      const service = yield* McpConfigService
      return yield* service.setServerEnabled({
        ...decoded.data,
        projectPath: validatedProjectPath,
      })
    }),
  )

  typedHandle('mcp:write-source-config', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(writeSourceConfigSchema, raw)
      if (!decoded.success) {
        const error = decoded.issues.join('; ')
        logger.warn('Invalid MCP source write payload', { error })
        return yield* Effect.fail(new Error(error))
      }
      const validatedProjectPath = yield* validateProjectPath(decoded.data.projectPath)
      const service = yield* McpConfigService
      return yield* service.writeSourceConfig({
        ...decoded.data,
        projectPath: validatedProjectPath,
      })
    }),
  )
}
