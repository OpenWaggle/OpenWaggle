import { request as sendHttpRequest } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getMcpProtocolOptions } from '../adapters/mcp/runtime/protocol-negotiation'
import { serveDualEraMcpLoopbackHttp } from '../mcp-server-http'

const TOKEN = 'openwaggle-loopback-fixture-token-with-more-than-32-bytes'
const TEST_REQUEST_BODY_LIMIT_BYTES = 32

function server() {
  const fixture = new McpServer({ name: 'loopback-fixture', version: '1.0.0' })
  fixture.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
    content: [{ type: 'text', text }],
  }))
  return fixture
}

async function connect(url: string, protocolVersion: '2026-07-28' | '2025-11-25') {
  const definition = {
    instanceId: `fixture-${protocolVersion}`,
    name: 'loopback-fixture',
    sourcePath: '/fixture/.mcp.json',
    configHash: 'fixture-hash',
    allowUnsandboxed: false,
    permissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
    definition: { url, transport: 'streamable-http' as const, protocolVersion },
  }
  const client = new Client(
    { name: `fixture-${protocolVersion}`, version: '1.0.0' },
    getMcpProtocolOptions(definition),
  )
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  })
  await client.connect(transport)
  return client
}

function statusForUnfinishedRequest(input: {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly firstChunk?: string
}) {
  return new Promise<number>((resolve, reject) => {
    const request = sendHttpRequest(
      input.url,
      { method: 'POST', headers: input.headers },
      (response) => {
        response.resume()
        response.once('end', () => {
          request.destroy()
          resolve(response.statusCode ?? 0)
        })
      },
    )
    request.once('error', reject)
    request.flushHeaders()
    if (input.firstChunk !== undefined) request.write(input.firstChunk)
  })
}

describe('OpenWaggle loopback Streamable HTTP server', () => {
  it('requires bearer authentication and serves modern and legacy MCP from one factory', async () => {
    const handle = await serveDualEraMcpLoopbackHttp({
      factory: server,
      port: 0,
      bearerToken: TOKEN,
    })
    try {
      await expect(fetch(handle.url, { method: 'POST' })).resolves.toMatchObject({ status: 401 })

      for (const protocolVersion of ['2026-07-28', '2025-11-25'] as const) {
        const client = await connect(handle.url, protocolVersion)
        try {
          await expect(client.listTools()).resolves.toMatchObject({
            tools: [expect.objectContaining({ name: 'echo' })],
          })
          expect(client.getNegotiatedProtocolVersion()).toBe(protocolVersion)
        } finally {
          await client.close()
        }
      }
    } finally {
      await handle.close()
    }
  })

  it('rejects unauthorized and cross-origin requests before waiting for their bodies', async () => {
    const handle = await serveDualEraMcpLoopbackHttp({
      factory: server,
      port: 0,
      bearerToken: TOKEN,
    })
    try {
      await expect(
        statusForUnfinishedRequest({
          url: handle.url,
          headers: { 'Transfer-Encoding': 'chunked' },
          firstChunk: 'still-open',
        }),
      ).resolves.toBe(401)
      await expect(
        statusForUnfinishedRequest({
          url: handle.url,
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Host: 'attacker.example',
            'Transfer-Encoding': 'chunked',
          },
          firstChunk: 'still-open',
        }),
      ).resolves.toBe(403)
      await expect(
        statusForUnfinishedRequest({
          url: handle.url,
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Origin: 'https://attacker.example',
            'Transfer-Encoding': 'chunked',
          },
          firstChunk: 'still-open',
        }),
      ).resolves.toBe(403)
    } finally {
      await handle.close()
    }
  })

  it('rejects declared and streamed bodies above the configured ceiling', async () => {
    const handle = await serveDualEraMcpLoopbackHttp({
      factory: server,
      port: 0,
      bearerToken: TOKEN,
      maxRequestBodyBytes: TEST_REQUEST_BODY_LIMIT_BYTES,
    })
    try {
      const authorization = { Authorization: `Bearer ${TOKEN}` }
      await expect(
        statusForUnfinishedRequest({
          url: handle.url,
          headers: {
            ...authorization,
            'Content-Length': String(TEST_REQUEST_BODY_LIMIT_BYTES + 1),
          },
        }),
      ).resolves.toBe(413)
      await expect(
        statusForUnfinishedRequest({
          url: handle.url,
          headers: { ...authorization, 'Transfer-Encoding': 'chunked' },
          firstChunk: 'x'.repeat(TEST_REQUEST_BODY_LIMIT_BYTES + 1),
        }),
      ).resolves.toBe(413)
    } finally {
      await handle.close()
    }
  })
})
