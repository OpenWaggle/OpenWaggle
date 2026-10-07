import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeMcpMigrationFs } from '../../migration/migration-fs'
import { addMcpServerEntry } from '../mcp-config-writer'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-symlink-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A dotfiles setup: ~/.pi/agent/mcp.json is a link into a dotfiles repository. */
function linkedFile() {
  const real = path.join(root, 'dotfiles', 'mcp.json')
  const link = path.join(root, 'home', '.pi', 'agent', 'mcp.json')
  mkdirSync(path.dirname(real), { recursive: true })
  mkdirSync(path.dirname(link), { recursive: true })
  writeFileSync(real, '{"mcpServers":{}}\n')
  symlinkSync(real, link)
  return { real, link }
}

describe.skipIf(process.platform === 'win32')('MCP files that are symbolic links', () => {
  it('are edited through the link: the link stays and the file it points to changes', () => {
    const { real, link } = linkedFile()

    addMcpServerEntry(link, 'fs', { command: 'fs-mcp' })

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(real, 'utf8'))).toEqual({
      mcpServers: { fs: { command: 'fs-mcp' } },
    })
  })

  it('are rewritten by the migration through the link too', async () => {
    const { real, link } = linkedFile()

    await nodeMcpMigrationFs.writeTextAtomic(link, '{"mcpServers":{"a":{"command":"a"}}}\n')

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(real, 'utf8')).toBe('{"mcpServers":{"a":{"command":"a"}}}\n')
  })
})
