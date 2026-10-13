import type { HostBackedMcpGuiChannel } from '@shared/types/host-ui-protocol'
import type { IpcInvokeArgs, IpcInvokeReturn } from '@shared/types/ipc'
import type { McpManagementArguments } from './mcp-cli-management-arguments'

export interface McpCliHost {
  readonly invoke: <C extends HostBackedMcpGuiChannel>(
    channel: C,
    ...args: IpcInvokeArgs<C>
  ) => Promise<IpcInvokeReturn<C>>
}

export interface McpCliOutput {
  readonly log: (text: string) => void
  readonly error: (text: string) => void
}

export interface McpManagementContext {
  readonly host: McpCliHost
  readonly output: McpCliOutput
  readonly workingDirectory: string
  readonly resolveProjectPath: (projectPath: string) => string
}

export const MCP_MANAGEMENT_EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2 } as const

export type McpManagementExit = (typeof MCP_MANAGEMENT_EXIT)[keyof typeof MCP_MANAGEMENT_EXIT]

export interface McpManagementCommandInput {
  readonly args: McpManagementArguments
  readonly projectPath: string | null
  readonly context: McpManagementContext
}
