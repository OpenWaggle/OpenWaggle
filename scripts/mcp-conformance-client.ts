import { resolve } from 'node:path'
import { MCP_SUPPORTED_PROTOCOL_VERSIONS } from '@shared/constants/mcp'
import type { McpRuntimeInteractions } from '../src/main/ports/mcp-runtime-service'
import { createFirstPartyMcpConnectionFactory } from '../src/main/adapters/mcp/runtime/sdk-client-connection'
import type { McpTurnSnapshot, McpTurnSnapshotServer } from '../src/shared/types/mcp'

const SCENARIO = process.env.MCP_CONFORMANCE_SCENARIO
const PROTOCOL_VERSION = process.env.MCP_CONFORMANCE_PROTOCOL_VERSION
const SERVER_URL = process.argv[2]
const CONFORMANCE_ADDEND_A = 2
const CONFORMANCE_ADDEND_B = 3

function assertInputs() {
  if (!SCENARIO || !SERVER_URL) {
    throw new Error(
      'Usage: MCP_CONFORMANCE_SCENARIO=<scenario> tsx scripts/mcp-conformance-client.ts <server-url>',
    )
  }
  if (
    PROTOCOL_VERSION &&
    !MCP_SUPPORTED_PROTOCOL_VERSIONS.some((version) => version === PROTOCOL_VERSION)
  ) {
    throw new Error(`Unsupported MCP conformance protocol version: ${PROTOCOL_VERSION}`)
  }
}

function fixture(serverUrl: URL) {
  const definition: McpTurnSnapshotServer = {
    instanceId: 'official-conformance-server',
    name: 'Official MCP conformance server',
    sourcePath: 'official-conformance',
    configHash: `official-conformance-${PROTOCOL_VERSION ?? 'auto'}`,
    allowUnsandboxed: false,
    permissions: { readRoots: [], writeRoots: [], allowNetwork: true },
    definition: {
      url: serverUrl.toString(),
      transport: 'streamable-http',
      ...(PROTOCOL_VERSION ? { protocolVersion: PROTOCOL_VERSION } : {}),
      security: {
        networkDomains: [serverUrl.hostname],
        oauthDomains: [serverUrl.hostname],
        allowInsecurePrivateNetwork: true,
      },
      clientCapabilities: {
        elicitation: 'form-and-url',
        roots: true,
        sampling: true,
      },
    },
  }
  const projectPath = resolve('.')
  const snapshot: McpTurnSnapshot = {
    id: 'official-conformance-turn',
    sessionId: 'official-conformance-session',
    projectPath,
    revision: definition.configHash,
    createdAt: Date.now(),
    effectiveState: 'on',
    servers: [definition],
  }
  return { definition, snapshot }
}

const interactions: McpRuntimeInteractions = {
  elicit: async () => ({ action: 'accept', content: {} }),
  sample: async () => ({
    model: 'openwaggle/conformance',
    role: 'assistant',
    content: { type: 'text', text: 'OpenWaggle conformance sampling response' },
    stopReason: 'endTurn',
  }),
}

async function callFirstTool(input: {
  readonly connection: Awaited<ReturnType<ReturnType<typeof createFirstPartyMcpConnectionFactory>>>
  readonly arguments?: Readonly<Record<string, unknown>>
}) {
  const [tool] = await input.connection.listTools()
  if (!tool) throw new Error('The official conformance server did not advertise a tool.')
  return input.connection.callTool({
    name: tool.name,
    arguments: input.arguments ?? { a: CONFORMANCE_ADDEND_A, b: CONFORMANCE_ADDEND_B },
    interactions,
  })
}

async function runScenario() {
  assertInputs()
  const serverUrl = new URL(SERVER_URL ?? '')
  const { definition, snapshot } = fixture(serverUrl)
  const factory = createFirstPartyMcpConnectionFactory({
    clientVersion: 'conformance',
    resolveSecret: async (name) => {
      throw new Error(`Official conformance attempted to resolve unexpected secret ${name}.`)
    },
  })
  const connection = await factory({ snapshot, server: definition })
  try {
    if (SCENARIO === 'initialize') return
    if (SCENARIO === 'tools_call') {
      await callFirstTool({ connection })
      return
    }
    if (SCENARIO === 'request-metadata') return
    if (SCENARIO === 'json-schema-ref-no-deref') {
      await connection.listTools()
      return
    }
    if (SCENARIO === 'json-schema-2020-12-preservation') {
      const tools = await connection.listTools()
      const schemaTool = tools.find((tool) => tool.name === 'json_schema_2020_12_tool')
      if (!schemaTool) throw new Error('The JSON Schema conformance tool was not advertised.')
      await connection.callTool({
        name: 'json_schema_echo',
        arguments: { schema: schemaTool.inputSchema },
        interactions,
      })
      return
    }
    throw new Error(`OpenWaggle has no conformance behavior for scenario ${SCENARIO}.`)
  } finally {
    await connection.close()
  }
}

runScenario().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
