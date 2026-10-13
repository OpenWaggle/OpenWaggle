import type { McpServerEntry } from '@earendil-works/pi-coding-agent'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadMcpShellEnvironment,
  resetMcpShellEnvironmentForTests,
} from '../../../../mcp-shell-environment'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { withShellResolvedClientSecrets } from '../pi-mcp-server-oauth'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** A server that reports two variables of its own environment. */
const SERVER = `
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'env', version: '1' } } })
  } else if (message.method === 'tools/call') {
    const text = JSON.stringify({ token: process.env.TOKEN, inherited: process.env.OW_ONLY_IN_LOGIN_SHELL })
    send({ id: message.id, result: { content: [{ type: 'text', text }] } })
  }
})
`

/** The login shell defines a variable the app's own environment does not have. */
async function loginShellWith(variables: Readonly<Record<string, string>>) {
  const body = Object.entries(variables)
    .map(([name, value]) => `${name}=${value}\0`)
    .join('')
  await loadMcpShellEnvironment({
    platform: 'darwin',
    shells: ['/bin/zsh'],
    runner: async () => `__OPENWAGGLE_ENV_ALL_START__\n${body}\n__OPENWAGGLE_ENV_ALL_END__\n`,
  })
}

const pools: McpSessionConnectionPool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
  resetMcpShellEnvironmentForTests()
})

describe(`MCP \${NAME} values from the user's login shell`, () => {
  it('resolves env values from it and gives the server process its variables', async () => {
    await loginShellWith({ OW_ONLY_IN_LOGIN_SHELL: 'from-zshrc' })
    const pool = new McpSessionConnectionPool()
    pools.push(pool)
    const entry = {
      name: 'env',
      config: {
        command: process.execPath,
        args: ['-e', SERVER],
        env: { TOKEN: `Bearer \${OW_ONLY_IN_LOGIN_SHELL}` },
      },
      source: 'test',
    }
    const client = new McpClient({ name: 'pi', version: '1' })
    await client.connect(
      pool.lease('s1', {
        name: 'env',
        fingerprint: 'v1',
        open: () =>
          openPiMcpUpstream({
            entry,
            transport: 'stdio',
            cwd: process.cwd(),
            authProvider: undefined,
          }),
      }),
    )

    const result = await client.callTool('env', {})
    const first = result.content[0]

    expect(JSON.parse(first?.type === 'text' ? first.text : '{}')).toEqual({
      token: 'Bearer from-zshrc',
      inherited: 'from-zshrc',
    })
    await client.close()
  })

  it("resolves an OAuth client secret before Pi's own resolver, which reads only the app's", async () => {
    await loginShellWith({ OW_ONLY_IN_LOGIN_SHELL: 'sec$ret' })
    const servers: McpServerEntry[] = [
      {
        name: 'docs',
        config: {
          url: 'https://docs.example/mcp',
          oauth: { clientId: 'c', clientSecret: `\${OW_ONLY_IN_LOGIN_SHELL}` },
        },
        source: 'test',
        scope: 'global',
      },
    ]

    const [resolved] = withShellResolvedClientSecrets({ servers, errors: [] }).servers

    expect(resolved?.config).toMatchObject({ oauth: { clientSecret: 'sec$$ret' } })
  })
})
