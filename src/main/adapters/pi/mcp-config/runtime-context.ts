import { homedir } from 'node:os'
import { type AgentSessionServices, getAgentDir } from '@mariozechner/pi-coding-agent'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { installMcpAdapterPackage } from './adapter-package'
import { createPiMcpConfigService } from './service-factory'
import { mcpRuntimeContextsByServices, type OpenWaggleMcpRuntimeContext } from './types'

let mcpAdapterProcessContextQueue: Promise<void> = Promise.resolve()

export async function prepareOpenWaggleMcpRuntimeContext(
  projectPath: string,
): Promise<OpenWaggleMcpRuntimeContext | null> {
  const service = createPiMcpConfigService({
    homeDir: homedir(),
    agentDir: getAgentDir(),
    installAdapterPackage: installMcpAdapterPackage,
  })
  return service.prepareRuntimeContext(projectPath)
}

function withMcpConfigArgv(argv: readonly string[], configPath: string) {
  const nextArgv: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === MCP_CONFIG.ARG_CONFIG_FLAG) {
      index += 1
      continue
    }
    nextArgv.push(argv[index] ?? '')
  }
  nextArgv.push(MCP_CONFIG.ARG_CONFIG_FLAG, configPath)
  return nextArgv
}

async function acquireMcpAdapterProcessContextLock() {
  const previous = mcpAdapterProcessContextQueue
  let releaseCurrent: (() => void) | undefined
  mcpAdapterProcessContextQueue = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  await previous
  return () => releaseCurrent?.()
}

export async function withOpenWaggleMcpAdapterProcessContext<T>(
  context: OpenWaggleMcpRuntimeContext | null,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireMcpAdapterProcessContextLock()
  if (!context) {
    try {
      return await operation()
    } finally {
      release()
    }
  }

  const previousCwd = process.cwd
  const previousArgv = [...process.argv]
  process.cwd = () => context.adapterCwd
  process.argv.splice(
    0,
    process.argv.length,
    ...withMcpConfigArgv(previousArgv, context.configPath),
  )
  try {
    return await operation()
  } finally {
    process.cwd = previousCwd
    process.argv.splice(0, process.argv.length, ...previousArgv)
    release()
  }
}

export function rememberOpenWaggleMcpRuntimeContext(
  services: AgentSessionServices,
  context: OpenWaggleMcpRuntimeContext | null,
) {
  if (context) {
    mcpRuntimeContextsByServices.set(services, context)
  }
}

export function getOpenWaggleMcpRuntimeContextForServices(
  services: AgentSessionServices,
): OpenWaggleMcpRuntimeContext | null {
  return mcpRuntimeContextsByServices.get(services) ?? null
}
