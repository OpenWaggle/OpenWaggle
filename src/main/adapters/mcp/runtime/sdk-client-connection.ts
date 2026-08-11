import {
  type AuthProvider,
  Client,
  StreamableHTTPClientTransport,
  type Transport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { MCP_CONFIG, MCP_SKILLS_EXTENSION_ID } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpCapabilityFamily, McpJsonValue } from '@shared/types/mcp'
import { createLegacySseClientTransport } from './legacy-sse-client-transport'
import { getMcpProtocolOptions } from './protocol-negotiation'
import { createMcpCapabilityMethods } from './sdk-client-capabilities'
import { createMcpEventMethods } from './sdk-client-events'
import { createMcpInteractionController } from './sdk-client-interactions'
import { createMcpSkillMethods } from './sdk-client-skills'
import { resolveMcpCredentialMap } from './secret-resolution'
import { createSecureMcpFetch } from './secure-fetch'
import { createSandboxedStdioCommand } from './stdio-sandbox'
import { monitorMcpStderr } from './stdio-stderr'
import type {
  McpClientConnection,
  McpConnectionFactory,
  McpRuntimeTool,
  McpRuntimeToolResult,
  McpSecretResolver,
} from './types'
import { LegacyWebSocketClientTransport } from './websocket-transport'

function toJsonValue(value: unknown): McpJsonValue {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  const parsed: unknown = JSON.parse(serialized)
  return decodeUnknownOrThrow(mcpConfigValueSchema, parsed)
}

type ServerCapabilities = NonNullable<ReturnType<Client['getServerCapabilities']>>

function advertisedFamilies(capabilities: ServerCapabilities): McpCapabilityFamily[] {
  const families: McpCapabilityFamily[] = []
  if (capabilities.tools) families.push('tools')
  if (capabilities.prompts) families.push('prompts')
  if (capabilities.resources) {
    families.push('resources')
    if (capabilities.resources.subscribe || capabilities.resources.listChanged) {
      families.push('subscriptions')
    }
  }
  if (capabilities.tasks) families.push('tasks')
  return families
}

function interactionFamilies(
  capabilities: ServerCapabilities,
  server: Parameters<McpConnectionFactory>[0]['server'],
): McpCapabilityFamily[] {
  const families: McpCapabilityFamily[] = []
  if (server.definition.clientCapabilities?.elicitation !== false) families.push('elicitation')
  if (server.definition.clientCapabilities?.sampling === true) families.push('sampling-legacy')
  if (server.definition.clientCapabilities?.roots !== false) families.push('roots-legacy')
  if (capabilities.logging && server.definition.clientCapabilities?.loggingLevel !== 'off') {
    families.push('logging-legacy')
  }
  return families
}

function capabilityFamilies(
  client: Client,
  server: Parameters<McpConnectionFactory>[0]['server'],
): McpCapabilityFamily[] {
  const capabilities = client.getServerCapabilities()
  if (!capabilities) return []
  const skillDeclaration =
    capabilities.extensions?.[MCP_SKILLS_EXTENSION_ID] ??
    capabilities.experimental?.[MCP_SKILLS_EXTENSION_ID]
  const skills: McpCapabilityFamily[] =
    skillDeclaration && server.definition.clientCapabilities?.remoteSkills === true
      ? ['skills']
      : []
  return [
    ...advertisedFamilies(capabilities),
    ...interactionFamilies(capabilities, server),
    ...skills,
  ]
}

function skillExtension(client: Client) {
  const capabilities = client.getServerCapabilities()
  const declaration =
    capabilities?.extensions?.[MCP_SKILLS_EXTENSION_ID] ??
    capabilities?.experimental?.[MCP_SKILLS_EXTENSION_ID]
  if (!declaration) return undefined
  return { directoryRead: declaration.directoryRead === true }
}

function boundedInstructions(value: string | undefined) {
  if (!value) return undefined
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= MCP_CONFIG.MAX_SERVER_INSTRUCTIONS_BYTES) {
    return { value, truncated: false }
  }
  return {
    value: bytes.subarray(0, MCP_CONFIG.MAX_SERVER_INSTRUCTIONS_BYTES).toString('utf8'),
    truncated: true,
  }
}

function mapTool(tool: Awaited<ReturnType<Client['listTools']>>['tools'][number]): McpRuntimeTool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: toJsonValue(tool.inputSchema),
    ...(tool.outputSchema ? { outputSchema: toJsonValue(tool.outputSchema) } : {}),
    ...(tool.annotations ? { annotations: toJsonValue(tool.annotations) } : {}),
    ...(tool._meta ? { meta: toJsonValue(tool._meta) } : {}),
  }
}

function createConnection(
  client: Client,
  serverDefinition: Parameters<McpConnectionFactory>[0]['server'],
  interactions: ReturnType<typeof createMcpInteractionController>,
): McpClientConnection {
  const negotiatedProtocolVersion = client.getNegotiatedProtocolVersion()
  if (!negotiatedProtocolVersion)
    throw new Error('MCP server did not negotiate a protocol version.')
  const server = client.getServerVersion()
  const instructions = boundedInstructions(client.getInstructions())
  const skills = skillExtension(client)

  return {
    negotiatedProtocolVersion,
    capabilities: capabilityFamilies(client, serverDefinition),
    ...(server ? { serverClaim: { name: server.name, version: server.version } } : {}),
    ...(instructions
      ? { instructions: instructions.value, instructionsTruncated: instructions.truncated }
      : {}),
    ...(skills ? { skillExtension: skills } : {}),
    async listTools(signal) {
      const result = await client.listTools(undefined, {
        signal,
        timeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
        maxTotalTimeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
        cacheMode: 'refresh',
      })
      return result.tools.map(mapTool)
    },
    async callTool(input): Promise<McpRuntimeToolResult> {
      const result = await interactions.run(input.interactions, () =>
        client.callTool(
          { name: input.name, arguments: { ...input.arguments } },
          {
            signal: input.signal,
            timeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
            maxTotalTimeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
          },
        ),
      )
      return {
        content: toJsonValue(result.content),
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: toJsonValue(result.structuredContent) }),
        isError: result.isError === true,
      }
    },
    ...createMcpCapabilityMethods(client),
    ...createMcpSkillMethods(client),
    ...createMcpEventMethods(client, serverDefinition.definition.clientCapabilities?.loggingLevel),
    close: () => client.close(),
  }
}

function withTransportCleanup<T extends Transport>(transport: T, cleanup: () => Promise<void>) {
  const closeTransport = transport.close.bind(transport)
  let cleaned = false
  transport.close = async () => {
    try {
      await closeTransport()
    } finally {
      if (!cleaned) {
        cleaned = true
        await cleanup()
      }
    }
  }
  return transport
}

async function createTransport(input: {
  readonly snapshot: Parameters<McpConnectionFactory>[0]['snapshot']
  readonly server: Parameters<McpConnectionFactory>[0]['server']
  readonly resolveSecret: McpSecretResolver
  readonly createAuthProvider?: (
    server: Parameters<McpConnectionFactory>[0]['server'],
  ) => AuthProvider
}): Promise<Transport> {
  const { definition } = input.server
  const transportKind = definition.transport ?? (definition.url ? 'streamable-http' : 'stdio')

  if (transportKind === 'stdio') {
    const env = await resolveMcpCredentialMap(definition.env, input.resolveSecret)
    const command = await createSandboxedStdioCommand({
      snapshot: input.snapshot,
      server: input.server,
      resolvedEnv: env,
    })
    const transport = new StdioClientTransport({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      env: command.env,
      stderr: 'pipe',
      maxBufferSize: MCP_CONFIG.MAX_RESULT_BYTES,
    })
    if (command.cleanup) withTransportCleanup(transport, command.cleanup)
    const containsVaultSecrets = Object.values(definition.env ?? {}).some(
      (value) => typeof value !== 'string',
    )
    monitorMcpStderr(transport, input.server.name, containsVaultSecrets)
    return transport
  }

  if (!definition.url) throw new Error(`MCP ${transportKind} transport requires a URL.`)
  const url = new URL(definition.url)
  const headers = await resolveMcpCredentialMap(definition.headers, input.resolveSecret)
  const networkDomains = definition.security?.networkDomains
  const allowInsecurePrivateNetwork = definition.security?.allowInsecurePrivateNetwork === true
  const authProvider = definition.auth ? input.createAuthProvider?.(input.server) : undefined

  if (transportKind === 'websocket') {
    return new LegacyWebSocketClientTransport({
      url,
      headers,
      allowedDomains: networkDomains,
      allowInsecurePrivateNetwork,
    })
  }

  const secureFetch = createSecureMcpFetch({
    baseUrl: url,
    allowedDomains: networkDomains,
    allowInsecurePrivateNetwork,
  })
  const options = {
    requestInit: { headers },
    fetch: secureFetch,
    ...(authProvider ? { authProvider } : {}),
    onInsufficientScope: 'throw' as const,
  }
  const transport =
    transportKind === 'sse'
      ? await createLegacySseClientTransport(url, options)
      : new StreamableHTTPClientTransport(url, options)
  return withTransportCleanup(transport, secureFetch.close)
}

export function createFirstPartyMcpConnectionFactory(input: {
  readonly resolveSecret: McpSecretResolver
  readonly createAuthProvider?: (
    server: Parameters<McpConnectionFactory>[0]['server'],
  ) => AuthProvider
  readonly clientVersion: string
}): McpConnectionFactory {
  return async ({ snapshot, server }) => {
    const client = new Client(
      { name: 'OpenWaggle', version: input.clientVersion },
      {
        capabilities: {},
        enforceStrictCapabilities: true,
        inputRequired: { autoFulfill: true, maxRounds: MCP_CONFIG.MAX_INPUT_REQUIRED_ROUNDS },
        listMaxPages: MCP_CONFIG.MAX_LIST_PAGES,
        defaultCacheTtlMs: MCP_CONFIG.CATALOG_CACHE_TTL_MS,
        cachePartition: snapshot.sessionId,
        ...getMcpProtocolOptions(server),
      },
    )
    const interactions = createMcpInteractionController({ client, snapshot, server })
    const transport = await createTransport({
      snapshot,
      server,
      resolveSecret: input.resolveSecret,
      ...(input.createAuthProvider ? { createAuthProvider: input.createAuthProvider } : {}),
    })
    try {
      await client.connect(transport, {
        timeout: MCP_CONFIG.CONNECT_TIMEOUT_MS,
        maxTotalTimeout: MCP_CONFIG.CONNECT_TIMEOUT_MS,
      })
      return createConnection(client, server, interactions)
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
  }
}
