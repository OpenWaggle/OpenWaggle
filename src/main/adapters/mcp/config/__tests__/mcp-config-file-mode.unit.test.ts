import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateMcpServerSettings } from '../mcp-config-writer'

const PERMISSIONS = 0o777
const GROUP_WRITABLE = 0o664

let root: string
let previousUmask: number

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-file-mode-'))
  // The common default: group and others lose write on every file the process creates.
  previousUmask = process.umask(0o022)
})

afterEach(() => {
  process.umask(previousUmask)
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('an MCP file a change rewrites', () => {
  it('keeps a group-writable mode the umask would take away', () => {
    const filePath = path.join(root, '.mcp.json')
    writeFileSync(filePath, '{\n  "mcpServers": {\n    "docs": { "command": "docs" }\n  }\n}\n')
    chmodSync(filePath, GROUP_WRITABLE)

    updateMcpServerSettings(filePath, 'docs', { enabled: false })

    expect(statSync(filePath).mode & PERMISSIONS).toBe(GROUP_WRITABLE)
  })
})
