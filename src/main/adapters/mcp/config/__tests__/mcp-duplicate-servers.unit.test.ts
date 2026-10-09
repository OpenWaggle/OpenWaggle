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
})
