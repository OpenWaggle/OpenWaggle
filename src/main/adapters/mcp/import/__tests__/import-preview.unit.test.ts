import { describe, expect, it } from 'vitest'
import { CLAUDE_CODE_CONFIG_FILE } from '../import-paths'
import { previewMcpImports } from '../import-preview'

const HOME = '/home/user'
const PROJECT = '/work/app'

function files(entries: Record<string, unknown>) {
  const texts = new Map(
    Object.entries(entries).map(([filePath, value]) => [
      filePath,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  )
  const read: string[] = []
  return {
    read,
    readText: (filePath: string) => {
      read.push(filePath)
      return Promise.resolve(texts.get(filePath))
    },
  }
}

function preview(
  source: ReturnType<typeof files>,
  options: { readonly projectPath?: string } = {},
) {
  return previewMcpImports({
    homeDir: HOME,
    platform: 'darwin',
    readText: source.readText,
    ...options,
  })
}

function entryOf(result: Awaited<ReturnType<typeof previewMcpImports>>, name: string) {
  return result.candidates.find((candidate) => candidate.name === name)?.entry
}

describe('previewing MCP imports as Pi entries', () => {
  it('copies Claude Desktop entries and marks SSE endpoints and disabled servers', async () => {
    const source = files({
      [`${HOME}/Library/Application Support/Claude/claude_desktop_config.json`]: {
        mcpServers: {
          files: { command: 'npx', args: ['-y', 'files-mcp'], env: { ROOT: '/tmp' } },
          events: { type: 'sse', url: 'https://events.example.com/sse' },
          off: { command: 'off-mcp', disabled: true },
        },
      },
    })

    const result = await preview(source)

    expect(entryOf(result, 'files')).toEqual({
      command: 'npx',
      args: ['-y', 'files-mcp'],
      env: { ROOT: '/tmp' },
    })
    expect(entryOf(result, 'events')).toEqual({
      url: 'https://events.example.com/sse',
      type: 'sse',
    })
    expect(entryOf(result, 'off')).toEqual({ command: 'off-mcp', enabled: false })
    expect(result.candidates[0]).toMatchObject({
      source: 'claude-desktop',
      suggestedTarget: 'global',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('converts Codex TOML servers', async () => {
    const source = files({
      [`${HOME}/.codex/config.toml`]: [
        '[mcp_servers.docs]',
        'url = "https://docs.example.com/mcp"',
        'bearer_token_env_var = "DOCS_TOKEN"',
        'env_http_headers = { "X-Team" = "TEAM_ID" }',
        'tool_timeout_sec = 90',
        'disabled_tools = ["delete_page"]',
        '',
        '[mcp_servers.local]',
        'command = "local-mcp"',
        'args = ["--stdio"]',
        'enabled = false',
        '[mcp_servers.local.env]',
        'LEVEL = "debug"',
      ].join('\n'),
    })

    const result = await preview(source)

    expect(entryOf(result, 'docs')).toEqual({
      url: 'https://docs.example.com/mcp',
      headers: { Authorization: `Bearer \${DOCS_TOKEN}`, 'X-Team': `\${TEAM_ID}` },
      timeout: 90,
      toolExposure: { delete_page: 'hidden' },
    })
    expect(entryOf(result, 'local')).toEqual({
      command: 'local-mcp',
      args: ['--stdio'],
      env: { LEVEL: 'debug' },
      enabled: false,
    })
  })

  it('converts OpenCode local and remote servers', async () => {
    const source = files({
      [`${HOME}/.config/opencode/opencode.json`]: {
        mcp: {
          local: {
            type: 'local',
            command: ['bun', 'x', 'my-mcp'],
            environment: { API_URL: '{env:MY_API_URL}' },
          },
          remote: {
            type: 'remote',
            url: 'https://remote.example.com/mcp',
            enabled: false,
            oauth: { clientId: 'abc', scope: 'read' },
          },
        },
      },
    })

    const result = await preview(source)

    expect(entryOf(result, 'local')).toEqual({
      command: 'bun',
      args: ['x', 'my-mcp'],
      env: { API_URL: `\${MY_API_URL}` },
    })
    expect(entryOf(result, 'remote')).toEqual({
      url: 'https://remote.example.com/mcp',
      enabled: false,
      oauth: { clientId: 'abc', scope: 'read' },
    })
  })

  it('replaces VS Code input prompts with environment variables', async () => {
    const source = files({
      [`${PROJECT}/.vscode/mcp.json`]: {
        inputs: [{ id: 'gh-token', type: 'promptString' }],
        servers: {
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/',
            headers: { Authorization: `Bearer \${input:gh-token}` },
          },
        },
      },
    })

    const result = await preview(source, { projectPath: PROJECT })

    expect(result.candidates[0]).toMatchObject({
      source: 'vscode',
      suggestedTarget: 'project',
      entry: {
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: `Bearer \${GH_TOKEN}` },
      },
      warnings: [
        'headers.Authorization asked for VS Code input gh-token; Pi reads environment variable GH_TOKEN there instead, so set it in your shell.',
      ],
    })
  })

  it('reads Zed context servers in both command shapes', async () => {
    const source = files({
      [`${HOME}/.config/zed/settings.json`]: [
        '// Zed settings',
        '{',
        '  "context_servers": {',
        '    "nested": { "source": "custom", "command": { "path": "nested-mcp", "args": ["-v"], "env": {} } },',
        '    "flat": { "command": "flat-mcp", "args": [] },',
        '    "remote": { "url": "https://zed.example.com/mcp" },',
        '  },',
        '}',
      ].join('\n'),
    })

    const result = await preview(source)

    expect(entryOf(result, 'nested')).toEqual({ command: 'nested-mcp', args: ['-v'] })
    expect(entryOf(result, 'flat')).toEqual({ command: 'flat-mcp' })
    expect(entryOf(result, 'remote')).toEqual({ url: 'https://zed.example.com/mcp' })
  })

  it('does not read files that Pi and OpenWaggle read live', async () => {
    const source = files({})

    await preview(source, { projectPath: PROJECT })

    expect(source.read).not.toContain(`${HOME}/.pi/agent/mcp.json`)
    expect(source.read).not.toContain(`${PROJECT}/.mcp.json`)
    expect(source.read).not.toContain(`${PROJECT}/.pi/mcp.json`)
    expect(source.read.filter((filePath) => filePath.includes('.openwaggle'))).toEqual([])
  })

  it('keeps environment references and withholds plaintext credentials', async () => {
    const source = files({
      [`${HOME}/.cursor/mcp.json`]: {
        mcpServers: {
          api: {
            command: 'api-mcp',
            args: ['--api-key', 'sk-plaintext', '--verbose'],
            env: { API_TOKEN: 'sk-plaintext', FROM_ENV: `\${env:API_SECRET}`, MODE: 'fast' },
          },
        },
      },
    })

    const result = await preview(source)

    expect(result.candidates[0]).toMatchObject({
      entry: {
        command: 'api-mcp',
        args: ['--api-key', '--verbose'],
        env: { API_TOKEN: { secret: 'API_API_TOKEN' }, FROM_ENV: `\${API_SECRET}`, MODE: 'fast' },
      },
      warnings: [
        'A command-line credential after --api-key was not imported. Move it to the encrypted vault or an environment variable.',
        'env.API_TOKEN contains a plaintext credential. Its value was not imported; save it as vault secret API_API_TOKEN.',
      ],
    })
    expect(JSON.stringify(result)).not.toContain('sk-plaintext')
  })

  it('withholds a credential written as --flag=value and keeps the next argument', async () => {
    const source = files({
      [`${HOME}/.cursor/mcp.json`]: {
        mcpServers: {
          api: {
            command: 'api-mcp',
            args: ['--api-key=sk-inline', '--port', '8080', '--token=!pass show api'],
          },
        },
      },
    })

    const result = await preview(source)

    expect(result.candidates[0]).toMatchObject({
      // A value resolved when the server starts is not a plaintext credential.
      entry: { command: 'api-mcp', args: ['--port', '8080', '--token=!pass show api'] },
      warnings: [
        'A command-line credential in --api-key=… was not imported. Move it to the encrypted vault or an environment variable.',
      ],
    })
    expect(JSON.stringify(result)).not.toContain('sk-inline')
  })

  it('reports an unreadable source and still previews the others', async () => {
    const source = files({
      [`${HOME}/.cursor/mcp.json`]: '{ broken',
      [`${HOME}/${CLAUDE_CODE_CONFIG_FILE}`]: { mcpServers: { fine: { command: 'fine-mcp' } } },
    })

    const result = await preview(source)

    expect(result.candidates.map((candidate) => candidate.name)).toEqual(['fine'])
    expect(result.errors).toEqual([
      { source: 'cursor', path: `${HOME}/.cursor/mcp.json`, message: expect.any(String) },
    ])
  })
})
