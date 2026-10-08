import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addMcpServerEntry,
  createMcpUpdateConfig,
  removeMcpServerEntry,
  updateMcpServerSettings,
} from '../mcp-config-writer'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-writer-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function file(name: string, text?: string) {
  const filePath = path.join(root, name)
  if (text !== undefined) {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, text)
  }
  return filePath
}

function read(filePath: string) {
  return readFileSync(filePath, 'utf8')
}

describe('MCP config writer', () => {
  it('changes only the edited server and keeps the rest of the file as written', () => {
    const filePath = file(
      'mcp.json',
      '{\n    "mcpServers": {\n        "a": { "command": "a", "custom": 1 },\n        "b": { "command": "b" }\n    },\n    "other": true\n}\n',
    )

    updateMcpServerSettings(filePath, 'a', { enabled: false, exposure: 'direct' })

    expect(read(filePath)).toBe(
      '{\n    "mcpServers": {\n        "a": {\n            "command": "a",\n            "custom": 1,\n            "enabled": false,\n            "exposure": "direct"\n        },\n        "b": { "command": "b" }\n    },\n    "other": true\n}\n',
    )
  })

  it('keeps a compact file compact and its unknown keys, order, and file mode', () => {
    const original =
      '{"$schema":"https://example.com/mcp.schema.json","mcpServers":{"a":{"command":"a","x-team":{"owner":"infra"}},"b":{"url":"https://b.example/mcp"}},"z":[1,2]}\n'
    const filePath = file('.mcp.json', original)
    chmodSync(filePath, 0o644)

    updateMcpServerSettings(filePath, 'b', { enabled: false })
    addMcpServerEntry(filePath, 'c', { command: 'c' })
    removeMcpServerEntry(filePath, 'a')

    const text = read(filePath)
    expect(text.trimEnd().split('\n')).toHaveLength(1)
    expect(text.endsWith('}\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({
      $schema: 'https://example.com/mcp.schema.json',
      mcpServers: { b: { url: 'https://b.example/mcp', enabled: false }, c: { command: 'c' } },
      z: [1, 2],
    })
    expect(Object.keys(JSON.parse(text))).toEqual(['$schema', 'mcpServers', 'z'])
    expect(statSync(filePath).mode % 0o1000).toBe(0o644)
  })

  it('keeps Windows line endings and tab indentation', () => {
    const filePath = file(
      'mcp.json',
      '{\r\n\t"mcpServers": {\r\n\t\t"a": {\r\n\t\t\t"command": "a"\r\n\t\t}\r\n\t}\r\n}\r\n',
    )

    updateMcpServerSettings(filePath, 'a', { exposure: 'direct' })

    expect(read(filePath)).toBe(
      '{\r\n\t"mcpServers": {\r\n\t\t"a": {\r\n\t\t\t"command": "a",\r\n\t\t\t"exposure": "direct"\r\n\t\t}\r\n\t}\r\n}\r\n',
    )
  })

  it('drops default values from full entries but keeps them in overrides', () => {
    const filePath = file(
      'mcp.json',
      JSON.stringify({
        mcpServers: {
          full: { command: 'x', enabled: false, exposure: 'direct' },
          over: { enabled: false },
        },
      }),
    )

    updateMcpServerSettings(filePath, 'full', { enabled: true, exposure: 'codemode' })
    updateMcpServerSettings(filePath, 'over', { enabled: true, exposure: 'codemode' })

    expect(JSON.parse(read(filePath))).toEqual({
      mcpServers: { full: { command: 'x' }, over: { enabled: true, exposure: 'codemode' } },
    })
  })

  it('adds an override-only entry to a missing file and merges tool exposure', () => {
    const filePath = path.join(root, 'project', '.openwaggle', 'mcp.json')

    updateMcpServerSettings(filePath, 'figma', { enabled: false }, { override: true })
    updateMcpServerSettings(
      filePath,
      'figma',
      { toolExposure: { get_design: 'direct', 'delete_*': 'hidden' } },
      { override: true },
    )
    updateMcpServerSettings(
      filePath,
      'figma',
      { toolExposure: { 'delete_*': null } },
      { override: true },
    )

    expect(JSON.parse(read(filePath))).toEqual({
      mcpServers: { figma: { enabled: false, toolExposure: { get_design: 'direct' } } },
    })
  })

  it('resets inherited tool rules in an override instead of letting them show through', () => {
    const filePath = path.join(root, 'project', '.openwaggle', 'mcp.json')
    // The defining file hides delete_*; the override has no rules of its own yet.
    const inherited = { 'delete_*': 'hidden' } as const

    updateMcpServerSettings(
      filePath,
      'figma',
      { toolExposure: { 'delete_*': null }, inheritedToolExposure: inherited },
      { override: true },
    )
    expect(JSON.parse(read(filePath))).toEqual({ mcpServers: { figma: { toolExposure: {} } } })

    // A rule of the override set back to "Same as server": the defining file's rules return only
    // when the override says nothing, so it stays an explicit empty set.
    updateMcpServerSettings(
      filePath,
      'figma',
      { toolExposure: { get: 'direct' } },
      { override: true },
    )
    updateMcpServerSettings(filePath, 'figma', { toolExposure: { get: null } }, { override: true })
    expect(JSON.parse(read(filePath))).toEqual({ mcpServers: { figma: { toolExposure: {} } } })
  })

  it('drops an empty rule set from an override with nothing to reset', () => {
    const filePath = path.join(root, 'project', '.openwaggle', 'mcp.json')

    updateMcpServerSettings(filePath, 'figma', { enabled: false }, { override: true })
    updateMcpServerSettings(filePath, 'figma', { toolExposure: { get: null } }, { override: true })

    expect(JSON.parse(read(filePath))).toEqual({ mcpServers: { figma: { enabled: false } } })
  })

  it('refuses to change a server the file does not define', () => {
    const filePath = file('mcp.json', '{"mcpServers":{}}')

    expect(() => updateMcpServerSettings(filePath, 'ghost', { enabled: false })).toThrow(
      `${filePath} does not define MCP server "ghost"`,
    )
  })

  it('adds, replaces, and removes servers', () => {
    const filePath = path.join(root, 'new', 'mcp.json')

    expect(addMcpServerEntry(filePath, 'a', { command: 'a' })).toBe(false)
    expect(addMcpServerEntry(filePath, 'a', { url: 'https://a.example' })).toBe(true)
    expect(removeMcpServerEntry(filePath, 'missing')).toBe(false)
    expect(JSON.parse(read(filePath))).toEqual({ mcpServers: { a: { url: 'https://a.example' } } })
    expect(removeMcpServerEntry(filePath, 'a')).toBe(true)
    expect(JSON.parse(read(filePath))).toEqual({ mcpServers: {} })
    expect(removeMcpServerEntry(path.join(root, 'absent.json'), 'a')).toBe(false)
  })

  it("saves Pi's /mcp changes to the override when there is one, else to the source", () => {
    const source = file('global.json', JSON.stringify({ mcpServers: { s: { command: 's' } } }))
    const override = path.join(root, 'project.json')
    const changed: string[] = []
    const updateConfig = createMcpUpdateConfig((filePath) => changed.push(filePath))

    updateConfig({ name: 's', source, override }, { enabled: false })
    updateConfig({ name: 's', source }, { exposure: 'deferred' })

    expect(JSON.parse(read(override))).toEqual({ mcpServers: { s: { enabled: false } } })
    expect(JSON.parse(read(source))).toEqual({
      mcpServers: { s: { command: 's', exposure: 'deferred' } },
    })
    expect(changed).toEqual([override, source])
  })

  it("saves Pi's /mcp changes to a global override that Pi was not told about", () => {
    const source = file('pi-global.json', JSON.stringify({ mcpServers: { s: { command: 's' } } }))
    const globalOverride = file('openwaggle-global.json', JSON.stringify({ mcpServers: { s: {} } }))
    const updateConfig = createMcpUpdateConfig(
      () => undefined,
      (name) => (name === 's' ? globalOverride : undefined),
    )

    updateConfig({ name: 's', source }, { enabled: false })

    expect(JSON.parse(read(globalOverride))).toEqual({ mcpServers: { s: { enabled: false } } })
    expect(JSON.parse(read(source))).toEqual({ mcpServers: { s: { command: 's' } } })
  })
})
