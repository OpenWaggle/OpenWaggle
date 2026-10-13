import { Schema, safeDecodeUnknown } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { McpSecretVaultService } from '../ports/mcp-secret-vault-service'

const logger = createLogger('mcp-secret-operation')

const mcpSetSecretSchema = Schema.Struct({ name: Schema.String, value: Schema.String })
const mcpRemoveSecretSchema = Schema.Struct({ name: Schema.String })

function decodeSecretInput<A, I>(schema: Schema.Schema<A, I>, raw: unknown, action: string) {
  const decoded = safeDecodeUnknown(schema, raw)
  if (decoded.success) return Effect.succeed(decoded.data)
  const error = decoded.issues.join('; ')
  logger.warn(`Invalid MCP ${action} payload`, { error })
  return Effect.fail(new Error(error))
}

export function listMcpSecretsOperation() {
  return Effect.flatMap(McpSecretVaultService, (vault) => vault.list())
}

export function setMcpSecretOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decodeSecretInput(mcpSetSecretSchema, raw, 'secret write')
    const vault = yield* McpSecretVaultService
    return yield* Effect.uninterruptible(vault.set(input))
  })
}

export function removeMcpSecretOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decodeSecretInput(mcpRemoveSecretSchema, raw, 'secret removal')
    const vault = yield* McpSecretVaultService
    return yield* Effect.uninterruptible(vault.remove(input))
  })
}
