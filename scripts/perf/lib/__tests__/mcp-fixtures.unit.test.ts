import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURE_BROWSER_URL, writeHeavyUserMcpConfig } from '../mcp-fixtures'

/** R6 P3-10: the heavy-user fixture never points a browser MCP server at the dev:debug CDP port. */
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('heavy-user MCP fixture', () => {
  it('points the electron-devtools server at a port nothing listens on, never 9223', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-fixtures-'))
    roots.push(root)
    await writeHeavyUserMcpConfig({ agentDir: path.join(root, 'agent'), projectPath: root })

    const written = `${await readFile(path.join(root, '.mcp.json'), 'utf8')}${await readFile(path.join(root, 'agent', 'mcp.json'), 'utf8')}`
    expect(written).not.toContain('9223')
    expect(written).toContain(`--browserUrl=${FIXTURE_BROWSER_URL}`)
  })
})
