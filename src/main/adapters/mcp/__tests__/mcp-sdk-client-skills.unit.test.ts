import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { MCP_LATEST_PROTOCOL_VERSION, MCP_SKILLS_EXTENSION_ID } from '@shared/constants/mcp'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMcpSkillMethods } from '../runtime/sdk-client-skills'

const uri = 'skill://review/SKILL.md'
const entry = {
  uri,
  frontmatter: { name: 'review', description: 'Review a change' },
  resources: [{ uri, digest: `sha256:${'a'.repeat(64)}` }],
}

function fixtureServer() {
  const server = new McpServer({ name: 'skills-fixture', version: '1.0.0' })
  server.server.registerCapabilities({
    extensions: { [MCP_SKILLS_EXTENSION_ID]: { directoryRead: true } },
  })
  server.server.setRequestHandler(
    'skills/list',
    {
      params: z.object({ cursor: z.string().optional() }),
      result: z.object({
        skills: z.array(z.unknown()),
        nextCursor: z.string().optional(),
      }),
    },
    (params) =>
      params.cursor
        ? Promise.resolve({ skills: [entry] })
        : Promise.resolve({ skills: [], nextCursor: 'page-2' }),
  )
  server.server.setRequestHandler(
    'skills/get',
    {
      params: z.object({ uri: z.string() }),
      result: z.object({ skill: z.unknown() }),
    },
    (params) => Promise.resolve({ skill: { ...entry, uri: params.uri } }),
  )
  return server
}

describe('MCP draft Skills extension client', () => {
  it('validates, paginates, and retrieves SEP-2640 entries over modern MCP', async () => {
    let serverError: Error | undefined
    const handler = createMcpHandler(fixtureServer, {
      onerror: (error) => {
        serverError = error
      },
    })
    const client = new Client(
      { name: 'OpenWaggle Skills fixture', version: '1.0.0' },
      {
        supportedProtocolVersions: [MCP_LATEST_PROTOCOL_VERSION],
        versionNegotiation: { mode: { pin: MCP_LATEST_PROTOCOL_VERSION } },
      },
    )
    const transport = new StreamableHTTPClientTransport(
      new URL('https://skills.openwaggle.local/mcp'),
      { fetch: (url, init) => handler.fetch(new Request(url, init)) },
    )

    try {
      await client.connect(transport).catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}${serverError ? `; server: ${serverError.message}` : ''}`,
        )
      })
      const methods = createMcpSkillMethods(client)

      await expect(methods.listSkills()).resolves.toEqual({ skills: [entry] })
      await expect(methods.getSkill({ uri })).resolves.toEqual({ skill: entry })
    } finally {
      await client.close()
      await handler.close()
    }
  })
})
