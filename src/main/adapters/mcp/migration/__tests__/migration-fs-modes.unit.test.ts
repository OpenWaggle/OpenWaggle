import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeMcpMigrationFs } from '../migration-fs'

const PRIVATE = 0o600
const GROUP_READABLE = 0o640
const PERMISSION_BITS = 0o777

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-migration-modes-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function modeOf(filePath: string) {
  return statSync(filePath).mode & PERMISSION_BITS
}

function file(name: string, mode: number) {
  const filePath = path.join(root, name)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, '{}\n')
  chmodSync(filePath, mode)
  return filePath
}

describe.skipIf(process.platform === 'win32')('file modes the MCP migration writes', () => {
  it('keeps the mode of a file it rewrites, also through a symbolic link', async () => {
    const own = file('own/mcp.json', PRIVATE)
    const shared = file('dotfiles/mcp.json', GROUP_READABLE)
    const link = path.join(root, 'home/mcp.json')
    mkdirSync(path.dirname(link), { recursive: true })
    symlinkSync(shared, link)

    await nodeMcpMigrationFs.writeTextAtomic(own, '{"mcpServers":{}}\n')
    await nodeMcpMigrationFs.writeTextAtomic(link, '{"mcpServers":{}}\n')

    expect(modeOf(own)).toBe(PRIVATE)
    expect(modeOf(shared)).toBe(GROUP_READABLE)
  })

  it('creates new files and backups readable by the user only', async () => {
    const created = path.join(root, 'new/mcp.json')
    const backup = path.join(root, 'own/mcp.json.pre-adr-0048.bak')

    await nodeMcpMigrationFs.writeTextAtomic(created, '{}\n')
    await nodeMcpMigrationFs.createTextExclusive(backup, '{"secret":"x"}\n')

    expect(modeOf(created)).toBe(PRIVATE)
    expect(modeOf(backup)).toBe(PRIVATE)
  })
})
