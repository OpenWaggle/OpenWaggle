import type { McpRemoveSecretInput, McpSecretSummary, McpSetSecretInput } from '@shared/types/mcp'
import { Context, type Effect } from 'effect'
import type { McpVaultFailure } from './mcp-errors'

export interface McpSecretVaultServiceShape {
  readonly list: () => Effect.Effect<readonly McpSecretSummary[], McpVaultFailure>
  readonly resolve: (name: string) => Effect.Effect<string, McpVaultFailure>
  readonly set: (
    input: McpSetSecretInput,
  ) => Effect.Effect<readonly McpSecretSummary[], McpVaultFailure>
  readonly remove: (
    input: McpRemoveSecretInput,
  ) => Effect.Effect<readonly McpSecretSummary[], McpVaultFailure>
}

export class McpSecretVaultService extends Context.Tag('@openwaggle/McpSecretVaultService')<
  McpSecretVaultService,
  McpSecretVaultServiceShape
>() {}
