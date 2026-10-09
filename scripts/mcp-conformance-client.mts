/**
 * Client for the official MCP conformance suite (`pnpm test:mcp:conformance`).
 *
 * Drives Pi's MCP client (`@earendil-works/pi-mcp`, the one Pi's MCP extension uses) through
 * OpenWaggle's MCP transport layer: a pooled connection lease over streamable HTTP with
 * OpenWaggle's hardened fetch and client capabilities (ADR 0050). Pi's client negotiates
 * `2024-11-05` to `2025-11-25`; newer revisions are not exercised.
 */
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import { McpSessionConnectionPool } from '../src/main/adapters/mcp/pool/mcp-session-connection-pool'
import { openWaggleMcpConnectionHooks } from '../src/main/adapters/pi/mcp/mcp-session-context'
import { createMcpServerFetch } from '../src/main/adapters/mcp/pool/mcp-server-fetch'
import { MCP_MAX_MESSAGE_BYTES } from '../src/main/adapters/mcp/runtime/mcp-message-limit'

const SUPPORTED_PROTOCOL_VERSION = '2025-11-25'
const SCENARIO = process.env.MCP_CONFORMANCE_SCENARIO
const PROTOCOL_VERSION = process.env.MCP_CONFORMANCE_PROTOCOL_VERSION ?? SUPPORTED_PROTOCOL_VERSION
const SERVER_URL = process.argv[2]
const CONFORMANCE_ADDEND_A = 2
const CONFORMANCE_ADDEND_B = 3
const SESSION_ID = 'conformance'

function requireServerUrl() {
  if (!SCENARIO || !SERVER_URL) {
    throw new Error(
      'Usage: MCP_CONFORMANCE_SCENARIO=<scenario> tsx scripts/mcp-conformance-client.mts <server-url>',
    )
  }
  if (PROTOCOL_VERSION !== SUPPORTED_PROTOCOL_VERSION) {
    throw new Error(`Unsupported MCP conformance protocol version: ${PROTOCOL_VERSION}`)
  }
  return SERVER_URL
}

async function connect(pool: McpSessionConnectionPool, url: string) {
  // The same transport `openPiMcpUpstream` opens for an HTTP server.
  const lease = pool.lease(SESSION_ID, {
    name: 'conformance',
    fingerprint: url,
    open: () => ({
      transport: new StreamableHttpTransport({
        url,
        fetch: createMcpServerFetch(url),
        maxMessageBytes: MCP_MAX_MESSAGE_BYTES,
      }),
    }),
  })
  const client = new McpClient({ name: 'openwaggle-conformance', version: 'conformance' })
  await client.connect(lease)
  return client
}

async function callFirstTool(client: McpClient) {
  const [tool] = await client.listTools()
  if (!tool) throw new Error('The official conformance server did not advertise a tool.')
  await client.callTool(tool.name, { a: CONFORMANCE_ADDEND_A, b: CONFORMANCE_ADDEND_B })
}

const ECHO_TOOL = 'json_schema_echo'

/**
 * SEP-1613/SEP-2106: the focal tool's `inputSchema`, as Pi's client received it through the
 * transport layer, is sent back verbatim to the echo tool, which compares it with the original.
 * `$schema`, `$defs` (with `$anchor`), `additionalProperties`, and every nested keyword are kept.
 * The transport's provider schema repair deliberately flattens root `allOf`/`anyOf` and drops root
 * `if`/`then`/`else`, because Bedrock, Anthropic, and OpenAI refuse a tool whose parameters have
 * them at the root; the server still validates arguments against its own schema. Those two
 * SEP-2106 checks are therefore reported as skipped at 2025-11-25.
 */
async function echoFocalToolSchema(client: McpClient) {
  const tools = await client.listTools()
  const focal = tools.find((tool) => tool.name !== ECHO_TOOL)
  if (!focal) throw new Error('The official conformance server did not advertise its schema tool.')
  await client.callTool(ECHO_TOOL, { schema: focal.inputSchema })
}

async function runScenario() {
  // The connection hooks a Run's pooled connection gets, so `tools/list` results pass through the
  // same transport-layer adaptation (provider schema repair) as in a Session.
  const pool = new McpSessionConnectionPool({
    hooks: (sessionId, serverName) => {
      const hooks = openWaggleMcpConnectionHooks(sessionId, serverName)
      return {
        augmentInitializeParams: hooks.augmentInitializeParams,
        ...(hooks.adaptResult ? { adaptResult: hooks.adaptResult } : {}),
      }
    },
  })
  try {
    const client = await connect(pool, requireServerUrl())
    if (SCENARIO === 'initialize') return
    if (SCENARIO === 'tools_call') {
      await callFirstTool(client)
      return
    }
    if (SCENARIO === 'json-schema-2020-12-preservation') {
      await echoFocalToolSchema(client)
      return
    }
    throw new Error(`OpenWaggle has no conformance behavior for scenario ${SCENARIO}.`)
  } finally {
    await pool.closeAll()
  }
}

runScenario().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
