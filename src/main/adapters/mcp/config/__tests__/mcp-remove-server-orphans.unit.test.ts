import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'

let root: string
let homeDir: string
let globalFile: string
let otherProjectFile: string
const OTHER_PROJECT_TEXT =
  '{ "mcpServers": { "x": { "enabled": false }, "y": { "command": "y", "env": { "T": "1", "T": "2" } } } }\n'

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-remove-'))
  homeDir = path.join(root, 'home')
  globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
  otherProjectFile = path.join(root, 'b', '.openwaggle', 'mcp.json')
  mkdirSync(path.dirname(globalFile), { recursive: true })
  writeFileSync(globalFile, '{ "mcpServers": { "x": { "command": "x-server" } } }\n')
  // Another project turned "x" off, in a file that repeats a key, so it cannot be edited.
  mkdirSync(path.dirname(otherProjectFile), { recursive: true })
  writeFileSync(otherProjectFile, OTHER_PROJECT_TEXT)
  mkdirSync(path.join(root, 'a'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('removing a global MCP server', () => {
  it("succeeds and says what changed when another project's override cannot be removed", async () => {
    const service = createFilesystemMcpConfigurationService({
      homeDir,
      piAgentDir: path.join(homeDir, '.pi', 'agent'),
      knownProjectPaths: async () => [path.join(root, 'a'), path.join(root, 'b')],
    })
    const notified: string[] = []
    service.onChange((filePath) => notified.push(filePath))

    const result = await Effect.runPromise(
      Effect.either(service.removeServer({ projectPath: path.join(root, 'a'), name: 'x' })),
    )

    expect(Either.isRight(result)).toBe(true)
    expect(JSON.parse(readFileSync(globalFile, 'utf8'))).toEqual({ mcpServers: {} })
    // Warm connections are closed and Settings refreshes for the file that did change.
    expect(notified).toEqual([globalFile])
    // The override left behind shows as an orphan there.
    expect(readFileSync(otherProjectFile, 'utf8')).toBe(OTHER_PROJECT_TEXT)
  })
})
