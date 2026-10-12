import { describe, expect, it } from 'vitest'
import type { PendingMcpFileMigration } from '../../migration/migration-health'
import { mcpFilePendingNotice, mcpScopePendingNotice, mcpWriteRefusal } from '../mcp-write-refusal'

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

  it('words the notices by cause, so a Run says whether to wait or what to fix', () => {
    expect(mcpFilePendingNotice(pending({ cause: 'wait', error: 'the lock is held' }))).toBe(
      `${FILE} was not loaded, so its servers stay off: it waited (the lock is held) and is tried again shortly.`,
    )
    expect(mcpScopePendingNotice(pending({ error: 'Unexpected token' }))).toBe(
      `MCP servers stay off here until OpenWaggle has updated ${FILE}: Fix ${FILE} (Unexpected token).`,
    )
  })
})
