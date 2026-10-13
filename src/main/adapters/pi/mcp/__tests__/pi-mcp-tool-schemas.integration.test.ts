import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it } from 'vitest'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { providerToolPayloads } from '../../__tests__/provider-tool-payload.test-utils'
import { providerToolSchemaViolations } from '../../provider-tool-parameter-schema'
import { openWaggleMcpConnectionHooks } from '../mcp-session-context'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** A stdio MCP server with one tool whose input schema is a root `anyOf`, as some servers send. */
const SERVER = `
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
const union = {
  anyOf: [
    { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  ],
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'union', version: '1' } } })
  } else if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools: [{ name: 'find', inputSchema: union }] } })
  } else if (message.method === 'tools/call') {
    send({ id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(message.params.arguments) }] } })
  }
})
`

const pools: McpSessionConnectionPool[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function waitFor<T>(read: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = read()
  while (value === undefined) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
    value = read()
  }
  return value
}

/** Starts a Pi session with the server exposed directly and returns the tool Pi registered. */
async function registeredFindTool() {
  const agentDir = mkdtempSync(path.join(tmpdir(), 'ow-mcp-schema-'))
  dirs.push(agentDir)
  const pool = new McpSessionConnectionPool({ hooks: openWaggleMcpConnectionHooks })
  pools.push(pool)
  const entry = { name: 'union', config: { command: process.execPath, args: ['-e', SERVER] } }
  let tools: ExtensionAPI['getAllTools'] = () => []
  const resourceLoader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    noSkills: true,
    extensionFactories: [
      createMcpExtension({
        loadConfig: () => ({
          servers: [
            {
              ...entry,
              config: { ...entry.config, exposure: 'direct' },
              source: 'test',
              scope: 'global',
            },
          ],
          errors: [],
        }),
        createTransport: () =>
          pool.lease('s1', {
            name: 'union',
            fingerprint: 'v1',
            open: () =>
              openPiMcpUpstream({
                entry: { ...entry, source: 'test' },
                transport: 'stdio',
                cwd: agentDir,
                authProvider: undefined,
              }),
          }),
        startupWaitMs: 1_500,
      }),
      (api) => {
        tools = () => api.getAllTools()
      },
    ],
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: agentDir,
    agentDir,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  })
  try {
    await session.bindExtensions({})
    return await waitFor(() => tools().find((tool) => tool.name === 'mcp__union__find'))
  } finally {
    session.dispose()
  }
}

describe('MCP tool schemas Pi registers through the transport layer', () => {
  it('reach Bedrock and OpenAI with an object root when the server sends a root anyOf', async () => {
    const tool = await registeredFindTool()
    const payloads = await providerToolPayloads([
      fromPartial<ToolDefinition>({
        name: tool.name,
        description: 'find',
        parameters: tool.parameters,
      }),
    ])

    expect(providerToolSchemaViolations(payloads.bedrock.get(tool.name))).toEqual([])
    expect(providerToolSchemaViolations(payloads.openai.get(tool.name))).toEqual([])
    expect(payloads.openai.get(tool.name)).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' }, query: { type: 'string' } },
    })
  })
})
