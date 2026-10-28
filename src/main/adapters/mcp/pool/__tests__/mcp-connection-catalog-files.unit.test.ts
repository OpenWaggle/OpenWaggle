import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileBackedPackageBinStore } from '../../runtime/mcp-package-runner-bypass'
import {
  fileBackedMcpToolCatalogStore,
  MCP_TOOL_CATALOG_MAX_AGE_MS,
} from '../mcp-connection-catalog'

const PERMISSION_BITS = 0o777
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-state-'))
  directories.push(root)
  return root
}

const CATALOG = { initialize: {}, toolsPages: {}, savedAt: 1 }

describe.skipIf(process.platform === 'win32')('MCP state files (review R5 P3-2)', () => {
  it('keeps catalogs private to the user', () => {
    const directory = path.join(scratch(), 'tool-catalogs')
    fileBackedMcpToolCatalogStore(() => directory).write('key', CATALOG)

    expect(statSync(directory).mode & PERMISSION_BITS).toBe(0o700)
    expect(statSync(path.join(directory, 'key.json')).mode & PERMISSION_BITS).toBe(0o600)
  })

  it('keeps the package runner resolutions private and replaces them whole', () => {
    const file = path.join(scratch(), 'mcp', 'package-runner-bins.json')
    const store = fileBackedPackageBinStore(() => file)
    const entry = {
      command: '/bin/node',
      prefixArgs: [],
      binDirectory: '/cache/node_modules/.bin',
      resolvedAt: 1,
      pinned: false,
    }
    store.save({ a: entry })
    store.save({ a: entry, b: entry })

    expect(statSync(path.dirname(file)).mode & PERMISSION_BITS).toBe(0o700)
    expect(statSync(file).mode & PERMISSION_BITS).toBe(0o600)
    expect(readdirSync(path.dirname(file))).toEqual(['package-runner-bins.json'])
    expect(Object.keys(store.load())).toEqual(['a', 'b'])
  })

  it('prunes catalogs too old to be served once the Host writes one', async () => {
    const directory = path.join(scratch(), 'tool-catalogs')
    mkdirSync(directory, { recursive: true })
    const stale = path.join(directory, 'removed-server.json')
    const fresh = path.join(directory, 'other-server.json')
    writeFileSync(stale, '{}')
    writeFileSync(fresh, '{}')
    const old = (Date.now() - MCP_TOOL_CATALOG_MAX_AGE_MS - 60_000) / 1_000
    utimesSync(stale, old, old)

    fileBackedMcpToolCatalogStore(() => directory).write('key', CATALOG)

    await vi.waitFor(() => expect(existsSync(stale)).toBe(false))
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(path.join(directory, 'key.json'))).toBe(true)
  })
})
