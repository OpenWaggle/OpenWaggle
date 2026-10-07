/**
 * Client for the official MCP conformance suite (`pnpm test:mcp:conformance`).
 *
 * OpenWaggle no longer has its own MCP client (ADR 0048), so this drives the MCP SDK client
 * directly over Streamable HTTP for the `2025-11-25` scenarios. It will move onto Pi's MCP client
 * through OpenWaggle's transport layer once that lands. Revisions newer than `2025-11-25` are not
 * negotiated by Pi's client and are not exercised here.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const SUPPORTED_PROTOCOL_VERSION = '2025-11-25'
const SCENARIO = process.env.MCP_CONFORMANCE_SCENARIO
const PROTOCOL_VERSION = process.env.MCP_CONFORMANCE_PROTOCOL_VERSION ?? SUPPORTED_PROTOCOL_VERSION
const SERVER_URL = process.argv[2]
const CONFORMANCE_ADDEND_A = 2
const CONFORMANCE_ADDEND_B = 3

function requireServerUrl() {
  if (!SCENARIO || !SERVER_URL) {
    throw new Error(
      'Usage: MCP_CONFORMANCE_SCENARIO=<scenario> tsx scripts/mcp-conformance-client.ts <server-url>',
    )
  }
  if (PROTOCOL_VERSION !== SUPPORTED_PROTOCOL_VERSION) {
    throw new Error(`Unsupported MCP conformance protocol version: ${PROTOCOL_VERSION}`)
  }
  return new URL(SERVER_URL)
}

async function connect(serverUrl: URL) {
  const client = new Client(
    { name: 'openwaggle-conformance', version: 'conformance' },
    {
      supportedProtocolVersions: [PROTOCOL_VERSION],
      versionNegotiation: { mode: 'legacy' },
    },
  )
  await client.connect(new StreamableHTTPClientTransport(serverUrl))
  return client
}

async function callFirstTool(client: Client) {
  const { tools } = await client.listTools()
  const [tool] = tools
  if (!tool) throw new Error('The official conformance server did not advertise a tool.')
  await client.callTool({
    name: tool.name,
    arguments: { a: CONFORMANCE_ADDEND_A, b: CONFORMANCE_ADDEND_B },
  })
}

async function runScenario() {
  const client = await connect(requireServerUrl())
  try {
    if (SCENARIO === 'initialize') return
    if (SCENARIO === 'tools_call') {
      await callFirstTool(client)
      return
    }
    throw new Error(`OpenWaggle has no conformance behavior for scenario ${SCENARIO}.`)
  } finally {
    await client.close()
  }
}

runScenario().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
