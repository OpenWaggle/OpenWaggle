import type { McpRegistryServerView } from '@shared/types/mcp-registry'
import { describe, expect, it } from 'vitest'
import { CWD, run, view } from './mcp-cli-management.test-fixtures'

const WEATHER: McpRegistryServerView = {
  name: 'io.github.example/weather',
  version: '2.0.0',
  description: 'Weather forecasts.',
  suggestedName: 'weather',
  installOptions: [
    { method: 'remote', target: 'https://weather.example/mcp' },
    { method: 'npm', target: '@example/weather@1.2.3' },
  ],
}

function installed(
  name: string,
  secrets: readonly string[] = [],
  existingSecrets: readonly string[] = [],
  optionalSecrets: readonly string[] = [],
  extra: {
    optionalSecretArguments?: readonly string[]
    optionalSecretsNeedContainerEnv?: boolean
  } = {},
) {
  return {
    name,
    filePath: '/home/.openwaggle/mcp.json',
    secrets,
    existingSecrets,
    optionalSecrets,
    optionalSecretArguments: extra.optionalSecretArguments ?? [],
    optionalSecretsNeedContainerEnv: extra.optionalSecretsNeedContainerEnv ?? false,
    view: view([]),
  }
}

describe('openwaggle mcp registry', () => {
  it('searches the Registry through the Host and shows how each server runs', async () => {
    const result = await run('registry', ['search', 'weather', 'radar'], {
      'mcp:search-registry': () => ({ servers: [WEATHER] }),
    })

    expect(result.exitCode).toBe(0)
    expect(result.calls).toEqual([
      { channel: 'mcp:search-registry', input: { query: 'weather radar' } },
    ])
    expect(result.logs).toContain('io.github.example/weather (2.0.0): Weather forecasts.')
    expect(result.logs).toContain(
      'runs as: remote https://weather.example/mcp, npm @example/weather@1.2.3',
    )
  })

  it('looks up one version with get, and passes another registry with --registry', async () => {
    const result = await run(
      'registry',
      [
        'get',
        'io.github.example/weather',
        '--version',
        '2.0.0',
        '--registry',
        'https://mirror.example',
        '--json',
      ],
      { 'mcp:get-registry-server': () => WEATHER },
    )

    expect(result.calls[0]?.input).toEqual({
      registryName: 'io.github.example/weather',
      version: '2.0.0',
      registryUrl: 'https://mirror.example',
    })
    expect(JSON.parse(result.logs)).toEqual({
      schemaVersion: 1,
      type: 'response',
      command: 'mcp registry',
      result: WEATHER,
    })
  })

  it("adds a server to OpenWaggle's global file and names the secrets it needs", async () => {
    const result = await run('registry', ['add', 'io.github.example/weather'], {
      'mcp:install-registry-server': () =>
        installed('weather', ['WEATHER_KEY', 'WEATHER_TOKEN'], ['WEATHER_TOKEN']),
    })

    expect(result.exitCode).toBe(0)
    expect(result.calls[0]?.input).toEqual({
      projectPath: null,
      scope: 'global',
      registryName: 'io.github.example/weather',
    })
    expect(result.logs).toContain(
      'Installed global MCP server "weather" from the MCP Registry in /home/.openwaggle/mcp.json.',
    )
    expect(result.logs).toContain('It reads the vault secret WEATHER_KEY. Add it in')
    expect(result.logs).toContain(
      'It uses the vault secret WEATHER_TOKEN, which already exists; replace it in Settings > MCP > Secrets if it holds another value.',
    )
  })

  it('names the optional secrets it left out of the entry', async () => {
    const result = await run('registry', ['add', 'io.github.example/weather'], {
      'mcp:install-registry-server': () =>
        installed('weather', [], [], ['API_KEY', 'PREMIUM_TOKEN'], {
          optionalSecretArguments: ['--license-key'],
          optionalSecretsNeedContainerEnv: true,
        }),
    })

    expect(result.logs).toContain(
      'It can also use the optional secrets API_KEY, PREMIUM_TOKEN, which were left out so it starts without them. To use one, add it to env in /home/.openwaggle/mcp.json with a vault secret, and add -e NAME to args before the image so the container receives it.',
    )
    expect(result.logs).toContain(
      'It also takes the optional argument --license-key, which was left out: it needs a literal value in args, since a command line cannot read a vault secret.',
    )
  })

  it('installs a chosen package under another name for the current project', async () => {
    const result = await run(
      'registry',
      [
        'add',
        'io.github.example/weather',
        '-l',
        '--package',
        'npm',
        '--name',
        'forecast',
        '--exposure',
        'hidden',
      ],
      { 'mcp:install-registry-server': () => installed('forecast') },
    )

    expect(result.calls[0]?.input).toEqual({
      projectPath: CWD,
      scope: 'project',
      registryName: 'io.github.example/weather',
      method: 'npm',
      serverName: 'forecast',
      exposure: 'hidden',
    })
    expect(result.logs).toContain('openwaggle mcp list -l')
  })

  it('keeps --project in the hint it prints', async () => {
    const result = await run(
      'registry',
      ['add', 'io.github.example/weather', '--project', 'repo'],
      {
        'mcp:install-registry-server': () => installed('weather'),
      },
    )

    expect(result.calls[0]?.input).toMatchObject({
      projectPath: '/resolved/repo',
      scope: 'project',
    })
    expect(result.logs).toContain('Check it with: openwaggle mcp list --project /resolved/repo')
  })

  it('keeps the old --scope flag', async () => {
    const result = await run(
      'registry',
      ['add', 'io.github.example/weather', '--scope', 'project'],
      {
        'mcp:install-registry-server': () => installed('weather'),
      },
    )

    expect(result.calls[0]?.input).toMatchObject({ projectPath: CWD, scope: 'project' })
  })

  it.each([
    [['add'], /Usage: openwaggle mcp registry/],
    [['add', 'io.github.example/weather', '--package', 'cargo'], /--package must be one of/],
    [['add', 'io.github.example/weather', '--trust'], /Unknown option --trust/],
    [['add', 'io.github.example/weather', '--exposure', 'direct'], /Use --exposure codemode/],
    [['remove', 'io.github.example/weather'], /Usage: openwaggle mcp registry/],
  ])('refuses %j as a usage error', async (args, message) => {
    const result = await run('registry', args, {})

    expect(result.exitCode).toBe(2)
    expect(result.errors).toMatch(message)
    expect(result.calls).toEqual([])
  })
})
