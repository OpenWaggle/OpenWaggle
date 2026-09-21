import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { createLogger } from '../logger'
import { McpConfigService } from '../ports/mcp-config-service'
import { McpOAuthService } from '../ports/mcp-oauth-service'
import { McpRuntimeService } from '../ports/mcp-runtime-service'
import { withMcpManagementWrite } from './mcp-management-operation-gate'
import {
  decodeMcpOperationInput,
  mcpRemoveServerSchema,
  validateMcpProjectInput,
} from './mcp-operation-validation'

const logger = createLogger('mcp-authorization')

/**
 * Authorize one configured MCP server under the owning process's management
 * writer lease. Resolving the server definition, mutating OAuth credentials,
 * and reconciling runtime clients are one identity-bound operation.
 */
export function authorizeMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(
      mcpRemoveServerSchema,
      raw,
      'server authorization',
    )
    const input = yield* validateMcpProjectInput(decoded)
    const config = yield* McpConfigService
    const oauth = yield* McpOAuthService
    const runtime = yield* McpRuntimeService
    return yield* withMcpManagementWrite(
      Effect.gen(function* () {
        const server = yield* config.getServerDefinition(input)
        return yield* oauth.authorize(server).pipe(
          Effect.onExit((authorizationExit) =>
            runtime.reconcileIdleConnections().pipe(
              Effect.exit,
              Effect.flatMap((reconciliationExit) => {
                if (Exit.isSuccess(reconciliationExit)) return Effect.void
                if (Exit.isSuccess(authorizationExit)) {
                  return Effect.failCause(reconciliationExit.cause)
                }
                logger.error('MCP reconciliation failed after OAuth authorization ended.', {
                  error: Cause.pretty(reconciliationExit.cause),
                })
                return Effect.void
              }),
            ),
          ),
        )
      }),
    )
  })
}
