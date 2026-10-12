import { describe, expect, it } from 'vitest'
import type { PendingMcpFileMigration } from '../../migration/migration-health'
import { mcpWriteRefusal } from '../mcp-write-refusal'

const FILE = '/home/user/.openwaggle/mcp.json'

function pending(overrides: Partial<PendingMcpFileMigration>): PendingMcpFileMigration {
  return { path: FILE, error: 'boom', cause: 'content', keepsLegacyState: true, ...overrides }
}

describe('refusing an MCP write while its scope is not migrated', () => {
  it('does not refuse on a fresh install: no old state waits to undo it', () => {
    expect(mcpWriteRefusal(pending({ keepsLegacyState: false }))).toBeUndefined()
    expect(mcpWriteRefusal(undefined)).toBeUndefined()
  })

  it('says to try again shortly while the migration waits for something', () => {
    const refusal = mcpWriteRefusal(pending({ cause: 'wait', error: 'the lock is held' }))

    expect(refusal?.message).toContain('try again shortly')
    expect(refusal?.message).not.toContain('Fix')
  })

  it('names the file to fix, which may be the one the migration read', () => {
    const state = '/home/user/.openwaggle/mcp/state.json'
    const refusal = mcpWriteRefusal(pending({ source: state, error: 'Unexpected token' }))

    expect(refusal?.message).toContain(`Fix ${state} (Unexpected token)`)
    expect(refusal?.message).not.toContain('try again shortly')
  })
})
