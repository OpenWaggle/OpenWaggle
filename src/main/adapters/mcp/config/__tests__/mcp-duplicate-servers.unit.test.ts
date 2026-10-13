import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'
import { removeMcpServerEntry } from '../mcp-config-writer'

let root: string
let homeDir: string
let file: string

// Read, the last "docs" wins (JSON.parse, as Pi reads it); edited, the first would change.
const DUPLICATED = `{
  "mcpServers": {
    "docs": { "enabled": false },
    "docs": { "command": "docs-mcp" }
  }
}
`

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-duplicates-'))
  homeDir = path.join(root, 'home')
  file = path.join(homeDir, '.openwaggle', 'mcp.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, DUPLICATED)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('an MCP file that names a server twice', () => {
  it('is never edited, since the edit could change the entry nobody reads', () => {
    expect(() => removeMcpServerEntry(file, 'docs')).toThrow(
      `${file}: server "docs" is defined more than once`,
    )
    expect(readFileSync(file, 'utf8')).toBe(DUPLICATED)
  })

  it('shows as a configuration error in the view', async () => {
    const service = createFilesystemMcpConfigurationService({
      homeDir,
      piAgentDir: path.join(homeDir, '.pi', 'agent'),
    })

    const view = await Effect.runPromise(service.getView({ projectPath: null }))

    expect(view.errors).toContainEqual(
      expect.stringContaining(`${file}: server "docs" is defined more than once`),
    )
  })

  it('refuses a file that repeats a key at any level, such as mcpServers itself', async () => {
    const repeated = `{
  "mcpServers": {},
  "mcpServers": {
    "docs": { "enabled": false, "env": { "TOKEN": "a", "TOKEN": "b" } }
  }
}
`
    writeFileSync(file, repeated)
    const service = createFilesystemMcpConfigurationService({
      homeDir,
      piAgentDir: path.join(homeDir, '.pi', 'agent'),
    })

    expect(() => removeMcpServerEntry(file, 'docs')).toThrow(
      `${file}: "mcpServers" is defined more than once`,
    )
    expect(readFileSync(file, 'utf8')).toBe(repeated)
    const view = await Effect.runPromise(service.getView({ projectPath: null }))
    expect(view.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${file}: "mcpServers" is defined more than once`),
        expect.stringContaining(`${file}: "mcpServers.docs.env.TOKEN" is defined more than once`),
      ]),
    )
  })
})
