import { describe, expect, it } from 'vitest'
import { CWD, run, server, view } from './mcp-cli-management.test-fixtures'

describe('openwaggle mcp add', () => {
  it("adds a stdio server to OpenWaggle's global file and keeps the command's own flags", async () => {
    const result = await run(
      'add',
      ['tools', '--env', 'API=1', '--', 'npx', '-y', 'tools', '--port', '1'],
      {
        'mcp:get-configuration': () => view([]),
        'mcp:add-server': () => view([server({ name: 'tools' })]),
      },
    )

    expect(result.exitCode).toBe(0)
    expect(result.calls[1]).toEqual({
      channel: 'mcp:add-server',
      input: {
        projectPath: null,
        name: 'tools',
        scope: 'global',
        entry: { command: 'npx', args: ['-y', 'tools', '--port', '1'], env: { API: '1' } },
      },
    })
    expect(result.logs).toContain('Added global MCP server "tools" in /home/.openwaggle/mcp.json.')
  })

  it('treats arguments after the server command as the command, as pi mcp add does', async () => {
    const result = await run('add', ['files', 'uvx', 'files-mcp', '--stdio'], {
      'mcp:get-configuration': () => view([]),
      'mcp:add-server': () => view([]),
    })

    expect(result.calls[1]?.input).toMatchObject({
      entry: { command: 'uvx', args: ['files-mcp', '--stdio'] },
    })
  })

  it('adds an HTTP server to the project file with -l and builds its headers and OAuth', async () => {
    const result = await run(
      'add',
      [
        '-l',
        'docs',
        '--url',
        'https://docs.example/mcp',
        '--bearer-token-env-var',
        'DOCS_TOKEN',
        '--header-secret',
        'X-Key=docs-key',
        '--oauth-callback-port',
        '8765',
        '--exposure',
        'deferred',
      ],
      {
        'mcp:get-configuration': () => view([]),
        'mcp:add-server': () => view([server({ name: 'docs', usesOAuth: true })]),
      },
    )

    expect(result.calls[1]?.input).toEqual({
      projectPath: CWD,
      name: 'docs',
      scope: 'project',
      entry: {
        url: 'https://docs.example/mcp',
        headers: { 'X-Key': { secret: 'docs-key' }, Authorization: `Bearer \${DOCS_TOKEN}` },
        oauth: { callbackPort: 8765 },
        exposure: 'deferred',
      },
    })
    expect(result.logs).toContain('openwaggle mcp login docs -l')
  })

  it('keeps --project in the hints it prints', async () => {
    const result = await run(
      'add',
      ['--project', 'repo', 'docs', '--url', 'https://docs.example/mcp'],
      {
        'mcp:get-configuration': () => view([]),
        'mcp:add-server': () => view([server({ name: 'docs', usesOAuth: true })]),
      },
    )

    expect(result.calls[1]?.input).toMatchObject({ projectPath: '/resolved/repo' })
    expect(result.logs).toContain(
      'Check it with: openwaggle mcp list --project /resolved/repo. If it requires sign-in: openwaggle mcp login docs --project /resolved/repo',
    )
  })

  it('writes to the file picked with --file', async () => {
    const result = await run('add', ['tools', '--file', 'pi-global', '--', 'npx', 'tools'], {
      'mcp:get-configuration': () => view([]),
      'mcp:add-server': () => view([]),
    })

    expect(result.calls[1]?.input).toMatchObject({ scope: 'global', destination: 'pi-global' })
  })

  it.each([
    [['tools'], 'Usage: openwaggle mcp add'],
    [['tools', '--url', 'https://x', '--', 'npx'], 'Usage: openwaggle mcp add'],
    [['tools', '--header', 'A=1', '--', 'npx'], '--header only applies to HTTP servers'],
    [['tools', '--url', 'https://x', '--cwd', '/tmp'], '--cwd only applies to stdio servers'],
    [['tools', '--env', 'NOEQUALS', '--', 'npx'], '--env expects KEY=VALUE'],
    [['tools', '--file', '/etc/mcp.json', '--', 'npx'], '--file must be one of'],
    [['tools', '--trust', '--', 'npx'], 'Unknown option --trust.'],
    [['tools', '--url'], '--url needs a value.'],
  ])('rejects %j as a usage error before reaching the Host', async (args, message) => {
    const result = await run('add', args, {})

    expect(result.exitCode).toBe(2)
    expect(result.errors).toContain(message)
    expect(result.calls).toEqual([])
  })
})

describe('openwaggle mcp list', () => {
  it('connects only to enabled servers and fails when one is not connected', async () => {
    const result = await run('list', [], {
      'mcp:get-configuration': () =>
        view([
          server({ name: 'docs', exposure: 'deferred' }),
          server({ name: 'off', enabled: false }),
        ]),
      'mcp:inspect-server': (input) => ({
        name: input.name,
        state: 'connected',
        tools: [
          { name: 'search', exposure: 'direct', hasApp: false },
          { name: 'read', exposure: 'deferred', hasApp: false },
        ],
      }),
    })

    expect(result.calls.filter((call) => call.channel === 'mcp:inspect-server')).toHaveLength(1)
    expect(result.logs).toContain('docs: connected, 2 tools (deferred, global)')
    expect(result.logs).toContain('tools: search [direct], read')
    expect(result.logs).toContain('off: disabled (codemode, global)')
    expect(result.exitCode).toBe(0)
  })

  it('lists every server when one check fails outright, and exits 1', async () => {
    const result = await run('list', [], {
      'mcp:get-configuration': () => view([server({ name: 'bad' }), server({ name: 'docs' })]),
      'mcp:inspect-server': (input) => {
        if (input.name === 'bad') throw new Error('MCP_TOKEN is not set')
        return { name: input.name, state: 'connected', tools: [] }
      },
    })

    expect(result.logs).toContain('bad: failed')
    expect(result.logs).toContain('MCP_TOKEN is not set')
    expect(result.logs).toContain('docs: connected, 0 tools')
    expect(result.exitCode).toBe(1)
  })

  it('says a server needs a secret, as Settings and doctor do, rather than that it failed', async () => {
    const missing =
      'server "api": env "TOKEN" names vault secret "API_TOKEN", which could not be read'
    const result = await run('list', [], {
      'mcp:get-configuration': () => ({
        ...view([server({ name: 'api' })], [missing]),
        missingSecretErrors: [missing],
        missingSecretServers: ['api'],
      }),
      'mcp:inspect-server': ({ name }) => ({ name, state: 'failed', tools: [], error: missing }),
    })

    expect(result.logs).toContain('api: needs secret (codemode, global)')
    expect(result.logs).toContain('  add the secret under Settings > MCP > Secrets')
    expect(result.logs).not.toContain('api: failed')
    expect(result.exitCode).toBe(1)
  })

  it('reports sign-in, errors, and config errors as JSON and exits 1', async () => {
    const result = await run('list', ['--json'], {
      'mcp:get-configuration': () =>
        view([server({ name: 'sentry', usesOAuth: true })], ['bad: invalid entry']),
      'mcp:inspect-server': () => ({
        name: 'sentry',
        state: 'needs-sign-in',
        tools: [],
        error: 'Sign in required',
      }),
    })
    const parsed: unknown = JSON.parse(result.logs)

    expect(result.exitCode).toBe(1)
    expect(parsed).toMatchObject({ type: 'response', command: 'mcp list' })
    expect(Reflect.get(Object(parsed), 'result')).toMatchObject({
      servers: [{ name: 'sentry', state: 'needs-sign-in', error: 'Sign in required' }],
      errors: ['bad: invalid entry'],
    })
  })

  it('reads the project files for --project', async () => {
    const result = await run('list', ['--project', 'repo'], {
      'mcp:get-configuration': () => view([]),
    })

    expect(result.calls[0]?.input).toEqual({ projectPath: '/resolved/repo' })
    expect(result.logs).toContain('No MCP servers configured.')
  })
})

describe('openwaggle mcp list overrides', () => {
  it('labels an override in a global file as an override, not a project override', async () => {
    const result = await run('list', [], {
      'mcp:get-configuration': () =>
        view([
          server({
            name: 'docs',
            enabled: false,
            override: { fileId: 'openwaggle-global', path: '/home/.openwaggle/mcp.json' },
          }),
        ]),
    })

    expect(result.logs).toContain('  override: /home/.openwaggle/mcp.json')
    expect(result.logs).not.toContain('project override')
  })
})

describe('openwaggle mcp enable, disable, remove, login, logout', () => {
  it('switches a global server for this project only with --in-project', async () => {
    const result = await run('disable', ['docs', '--in-project'], {
      'mcp:set-server-enabled': () =>
        view([
          server({
            name: 'docs',
            enabled: false,
            override: { fileId: 'project-openwaggle', path: `${CWD}/.openwaggle/mcp.json` },
          }),
        ]),
    })

    expect(result.calls[0]?.input).toEqual({
      projectPath: CWD,
      name: 'docs',
      enabled: false,
      target: 'project',
    })
    expect(result.logs).toBe(
      `Disabled MCP server "docs" in this project; saved to ${CWD}/.openwaggle/mcp.json.`,
    )
  })

  it('removes a server from the file that defines it and names configured ones when missing', async () => {
    const removed = await run('remove', ['docs'], {
      'mcp:get-configuration': () => view([server({ name: 'docs' })]),
      'mcp:remove-server': () => view([]),
    })
    const missing = await run('remove', ['nope'], {
      'mcp:get-configuration': () => view([server({ name: 'docs' })]),
    })

    expect(removed.logs).toBe('Removed global MCP server "docs" from /home/.openwaggle/mcp.json.')
    expect(missing.exitCode).toBe(1)
    expect(missing.errors).toContain('No MCP server named "nope". Configured: docs.')
  })

  it('refuses to sign in to a server that does not use OAuth', async () => {
    const result = await run('login', ['tools'], {
      'mcp:get-configuration': () => view([server({ name: 'tools' })]),
    })

    expect(result.exitCode).toBe(1)
    expect(result.errors).toContain('does not use OAuth')
  })

  it('shows the authorization page when the Host could not open it', async () => {
    const result = await run('login', ['sentry'], {
      'mcp:get-configuration': () => view([server({ name: 'sentry', usesOAuth: true })]),
      'mcp:sign-in': () => ({ signedIn: false, authorizationUrl: 'https://auth.example/start' }),
    })

    expect(result.exitCode).toBe(1)
    expect(result.errors).toContain('https://auth.example/start')
  })

  it('signs out through the Host', async () => {
    const result = await run('logout', ['sentry'], {
      'mcp:get-configuration': () => view([server({ name: 'sentry', usesOAuth: true })]),
      'mcp:sign-out': () => undefined,
    })

    expect(result.exitCode).toBe(0)
    expect(result.logs).toBe('Signed out of MCP server "sentry".')
  })
})
