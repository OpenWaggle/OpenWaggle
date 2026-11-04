import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writePiWagglePresetsFileData } from '../../packages/pi-waggle/src/preset-storage'
import {
  isProviderQualifiedWaggleModel,
  isWaggleInheritedModel,
} from '../../packages/waggle-core/src/config'
import { addMcpServerEntry } from '../../src/main/adapters/mcp/config/mcp-config-writer'
import {
  mcpFileErrorsAtRuntime,
  patternOf,
  publishedSchemaErrors,
  readPublishedSchema,
  readWagglePresetsFileAtRuntime,
  record,
  removeScratchDirectories,
  scratchDirectory,
} from './published-json-schemas.test-harness'

const MCP = 'mcp.schema.json'
const WAGGLE = 'waggle-presets.schema.json'
const JSON_INDENT_SPACES = 2

afterEach(removeScratchDirectories)

describe('the mcp.json schema agrees with the runtime merge', () => {
  const file = (servers: Record<string, unknown>) => ({ mcpServers: servers })

  it.each([
    [
      'a local server',
      { fs: { command: 'npx', args: ['-y', 'server'], env: { KEY: '${KEY}' }, cwd: '.' } },
    ],
    [
      'a remote server with a secret',
      { gh: { url: 'https://example.com/mcp', headers: { Authorization: { secret: 'gh-auth' } } } },
    ],
    ['an SSE server', { old: { type: 'sse', url: 'http://localhost:3000/sse' } }],
    ['a WebSocket server', { ws: { url: 'wss://example.com/mcp' } }],
    ['an explicit stdio type', { fs: { type: 'stdio', command: 'uvx' } }],
    [
      'exposures',
      { fs: { command: 'x', exposure: 'deferred', toolExposure: { 'delete_*': 'hidden' } } },
    ],
    ['the older exposure name', { fs: { command: 'x', exposure: 'codemode-deferred' } }],
    [
      'an OAuth client',
      {
        s: {
          url: 'https://x.dev/mcp',
          oauth: { clientId: 'id', callbackPort: 8765, scope: 'read' },
        },
      },
    ],
    [
      'an override of a server an earlier file defines',
      { base: { enabled: false, exposure: 'hidden' } },
    ],
    ['a timeout', { fs: { command: 'x', timeout: 120, description: 'Files', enabled: true } }],
  ])('accepts %s', async (_name, servers) => {
    expect(await publishedSchemaErrors(MCP, file(servers))).toEqual([])
    expect(mcpFileErrorsAtRuntime(file(servers), ['base'])).toEqual([])
  })

  it.each([
    ['a server name with a space', { 'my docs': { command: 'x' } }],
    ['args that are not strings', { fs: { command: 'x', args: [1] } }],
    ['a zero timeout', { fs: { command: 'x', timeout: 0 } }],
    ['an unknown exposure', { fs: { command: 'x', exposure: 'visible' } }],
    ['a file URL', { r: { url: 'file:///tmp/mcp' } }],
    ['a ws URL for an SSE server', { r: { type: 'sse', url: 'ws://localhost/mcp' } }],
    ['an unknown transport type', { r: { type: 'grpc', url: 'https://x.dev' } }],
    [
      'a secret reference with an extra key',
      { r: { command: 'x', env: { K: { secret: 's', note: 1 } } } },
    ],
    ['an entry with neither command nor url', { r: { args: ['x'] } }],
    ['an override with a key overrides cannot set', { base: { enabled: false, description: 'x' } }],
    [
      'an OAuth port out of range',
      { s: { url: 'https://x.dev/mcp', oauth: { callbackPort: 70000 } } },
    ],
    [
      'an unknown OAuth registration',
      { s: { url: 'https://x.dev/mcp', oauth: { clientRegistration: 'manual' } } },
    ],
  ])('rejects %s', async (_name, servers) => {
    expect(await publishedSchemaErrors(MCP, file(servers))).not.toEqual([])
    expect(mcpFileErrorsAtRuntime(file(servers), ['base'])).not.toEqual([])
  })

  it('accepts a $schema key and keeps it when OpenWaggle adds a server', async () => {
    const schemaUrl = 'https://openwaggle.ai/schemas/mcp.schema.json'
    const value = { $schema: schemaUrl, mcpServers: {} }
    expect(mcpFileErrorsAtRuntime(value)).toEqual([])
    expect(await publishedSchemaErrors(MCP, value)).toEqual([])
    const filePath = path.join(scratchDirectory('ow-mcp-schema-key-'), 'mcp.json')
    await writeFile(filePath, `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`)
    addMcpServerEntry(filePath, 'fs', { command: 'npx' })
    const written = record(JSON.parse(await readFile(filePath, 'utf8')))
    expect(written.$schema).toBe(schemaUrl)
    expect(record(written.mcpServers).fs).toEqual({ command: 'npx' })
  })
})

const preset = {
  id: 'review',
  name: 'Review',
  description: 'Two reviewers.',
  config: {
    mode: 'sequential',
    agents: [
      { label: 'A', model: '$inherit', roleDescription: 'Propose.', color: 'blue' },
      { label: 'B', model: 'openai/gpt-5.4', roleDescription: 'Check.', color: 'amber' },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 8 },
  },
  isBuiltIn: false,
  createdAt: 0,
  updatedAt: 0,
}

describe('the Waggle presets schema agrees with the runtime reader', () => {
  it.each([
    ['an empty file', {}],
    [
      'one preset and a hidden built-in',
      { wagglePresets: [preset], hiddenBuiltInPresetIds: ['debate'] },
    ],
  ])('accepts %s', async (_name, file) => {
    expect(await publishedSchemaErrors(WAGGLE, file)).toEqual([])
    expect((await readWagglePresetsFileAtRuntime(file)).skipped).toBe(0)
  })

  it.each([
    [
      'a model without a provider',
      {
        ...preset,
        config: {
          ...preset.config,
          agents: [preset.config.agents[0], { ...preset.config.agents[1], model: 'gpt-5.4' }],
        },
      },
    ],
    ['one agent', { ...preset, config: { ...preset.config, agents: [preset.config.agents[0]] } }],
    [
      'an unknown color',
      {
        ...preset,
        config: {
          ...preset.config,
          agents: [{ ...preset.config.agents[0], color: 'red' }, preset.config.agents[1]],
        },
      },
    ],
    [
      'a turn limit of 0',
      {
        ...preset,
        config: { ...preset.config, stop: { primary: 'consensus', maxTurnsSafety: 0 } },
      },
    ],
    [
      'an unknown stop condition',
      { ...preset, config: { ...preset.config, stop: { primary: 'timeout', maxTurnsSafety: 8 } } },
    ],
    ['a negative timestamp', { ...preset, createdAt: -1 }],
    ['an empty id', { ...preset, id: '' }],
  ])('skips a preset with %s', async (_name, invalid) => {
    const file = { wagglePresets: [invalid] }
    expect(await publishedSchemaErrors(WAGGLE, file)).not.toEqual([])
    expect((await readWagglePresetsFileAtRuntime(file)).skipped).toBe(1)
  })

  it('has the model pattern of the runtime model check', async () => {
    const model = await patternOf(WAGGLE, [
      'properties',
      'wagglePresets',
      'items',
      'properties',
      'config',
      'properties',
      'agents',
      'prefixItems',
      '0',
      'properties',
      'model',
    ])
    for (const candidate of [
      '$inherit',
      'openai/gpt-5.4',
      'openrouter/anthropic/claude',
      'a/b',
      'gpt-5.4',
      '/model',
      'provider/',
      ' openai/gpt',
      'openai/gpt ',
      'open ai/gpt 5',
      '$inherit ',
    ]) {
      expect(model.test(candidate), candidate).toBe(
        isWaggleInheritedModel(candidate) || isProviderQualifiedWaggleModel(candidate),
      )
    }
  })

  it('describes exactly the keys pi-waggle writes, without a $schema key', async () => {
    const filePath = path.join(scratchDirectory('ow-waggle-keys-'), 'waggle-presets.json')
    await writePiWagglePresetsFileData(filePath, { wagglePresets: [], hiddenBuiltInPresetIds: [] })
    const written = Object.keys(record(JSON.parse(await readFile(filePath, 'utf8'))))
    const properties = Object.keys(record(record(await readPublishedSchema(WAGGLE)).properties))
    expect(written.sort()).toEqual(properties.sort())
  })
})
