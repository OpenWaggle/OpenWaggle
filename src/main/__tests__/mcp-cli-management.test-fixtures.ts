import type { HostBackedMcpGuiChannel } from '@shared/types/host-ui-protocol'
import type { IpcInvokeArgs, IpcInvokeReturn } from '@shared/types/ipc'
import type { McpConfigurationView, McpConfiguredServerView } from '@shared/types/mcp-configuration'
import { type McpCliHost, runMcpManagementCommand } from '../mcp-cli-management'

export const CWD = '/work/project'

export function server(overrides: Partial<McpConfiguredServerView> & { name: string }) {
  return {
    transport: 'stdio',
    target: 'npx tools-mcp',
    source: { fileId: 'openwaggle-global', path: '/home/.openwaggle/mcp.json' },
    scope: 'global',
    enabled: true,
    exposure: 'codemode',
    toolExposure: {},
    usesOAuth: false,
    ...overrides,
  } satisfies McpConfiguredServerView
}

export function view(servers: readonly McpConfiguredServerView[], errors: string[] = []) {
  return {
    projectPath: null,
    files: [
      {
        fileId: 'openwaggle-global',
        path: '/home/.openwaggle/mcp.json',
        scope: 'global',
        exists: true,
        openWaggleOwned: true,
      },
      {
        fileId: 'project-openwaggle',
        path: `${CWD}/.openwaggle/mcp.json`,
        scope: 'project',
        exists: false,
        openWaggleOwned: true,
      },
    ],
    servers,
    errors,
  } satisfies McpConfigurationView
}

export type Responder = {
  readonly [C in HostBackedMcpGuiChannel]?: (...args: IpcInvokeArgs<C>) => IpcInvokeReturn<C>
}

function fakeHost(responders: Responder) {
  const calls: { channel: HostBackedMcpGuiChannel; input: unknown }[] = []
  const host: McpCliHost = {
    invoke: (channel, ...args) => {
      calls.push({ channel, input: args[0] })
      const responder: ((...input: typeof args) => IpcInvokeReturn<typeof channel>) | undefined =
        responders[channel]
      if (!responder) return Promise.reject(new Error(`Unexpected ${channel}`))
      return Promise.resolve(responder(...args))
    },
  }
  return { host, calls }
}

export async function run(
  command: Parameters<typeof runMcpManagementCommand>[0],
  args: string[],
  responders: Responder,
) {
  const { host, calls } = fakeHost(responders)
  const logs: string[] = []
  const errors: string[] = []
  const exitCode = await runMcpManagementCommand(command, args, {
    host,
    output: { log: (text) => logs.push(text), error: (text) => errors.push(text) },
    workingDirectory: CWD,
    resolveProjectPath: (projectPath) => `/resolved/${projectPath}`,
  })
  return { exitCode, calls, logs: logs.join('\n'), errors: errors.join('\n') }
}
