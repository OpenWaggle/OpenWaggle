import { closeSync, openSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serveDualEraMcpStdio } from '../mcp-server-stdio'

describe('routed MCP stdio', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('delivers an actual initialize response through the isolated CLI descriptor', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mcp-routed-'))
    const outputPath = path.join(root, 'mcp-output.jsonl')
    const outputFd = openSync(outputPath, 'w+')
    vi.stubEnv('OPENWAGGLE_CLI_OUTPUT_FD', String(outputFd))
    vi.resetModules()
    const { routedCliStdoutStream } = await import('../cli-stdout')
    const stdout = routedCliStdoutStream()
    if (!stdout) throw new Error('Expected a routed CLI output stream.')
    const stdin = new PassThrough()
    const handle = serveDualEraMcpStdio(
      () => new McpServer({ name: 'routed-fixture', version: '1.0.0' }),
      { transport: new StdioServerTransport(stdin, stdout) },
    )
    try {
      stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'routed-test', version: '1.0.0' },
          },
        })}\n`,
      )
      await vi.waitFor(async () => {
        const response = JSON.parse(await fs.readFile(outputPath, 'utf8'))
        expect(response).toMatchObject({
          jsonrpc: '2.0',
          id: 1,
          result: { serverInfo: { name: 'routed-fixture' } },
        })
      })
    } finally {
      stdin.end()
      await handle.close()
      closeSync(outputFd)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
