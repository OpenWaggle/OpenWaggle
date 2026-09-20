import type { McpServerDefinition } from '@shared/types/mcp'
import { Context, type Effect } from 'effect'

export interface McpOAuthAuthorizationResult {
  readonly authorized: boolean
  readonly browserOpened: boolean
}

export interface McpOAuthServiceShape {
  readonly authorize: (input: {
    readonly instanceId: string
    readonly definition: McpServerDefinition
  }) => Effect.Effect<McpOAuthAuthorizationResult, Error>
  readonly revoke: (instanceId: string) => Effect.Effect<void, Error>
}

export class McpOAuthService extends Context.Tag('@openwaggle/McpOAuthService')<
  McpOAuthService,
  McpOAuthServiceShape
>() {}
