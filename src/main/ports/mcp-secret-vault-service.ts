import type { McpRemoveSecretInput, McpSecretSummary, McpSetSecretInput } from '@shared/types/mcp'
import { Context, type Effect } from 'effect'

export interface McpSecretVaultServiceShape {
  readonly list: () => Effect.Effect<readonly McpSecretSummary[], Error>
  readonly resolve: (name: string) => Effect.Effect<string, Error>
  readonly set: (input: McpSetSecretInput) => Effect.Effect<readonly McpSecretSummary[], Error>
  readonly remove: (
    input: McpRemoveSecretInput,
  ) => Effect.Effect<readonly McpSecretSummary[], Error>
}

export class McpSecretVaultService extends Context.Tag('@openwaggle/McpSecretVaultService')<
  McpSecretVaultService,
  McpSecretVaultServiceShape
>() {}
