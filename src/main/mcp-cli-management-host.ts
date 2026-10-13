import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { executeHostUi } from './application/configured-host-ui-client'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import type { ParsedArguments } from './mcp-cli-arguments'
import type { McpCliHost } from './mcp-cli-management'

/** Management commands run as the local machine user; named profiles cannot manage MCP. */
const NO_PROFILE_ARGUMENTS: ParsedArguments = {
  positionals: [],
  passthrough: [],
  options: new Map(),
}

/** Reaches the Session Host (starting it on first use) for `openwaggle mcp` management commands. */
export function createMcpCliHost(): McpCliHost {
  let client: ReturnType<typeof createLocalSessionCliClientInput> | undefined
  return {
    invoke: async (channel, ...args) => {
      client ??= createLocalSessionCliClientInput(NO_PROFILE_ARGUMENTS, {
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
      })
      return executeHostUi({ client: await client, channel, args })
    },
  }
}
