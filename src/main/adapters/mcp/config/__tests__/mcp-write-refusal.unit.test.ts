import { describe, expect, it, vi } from 'vitest'
import type { PendingMcpFileMigration } from '../../migration/migration-health'
import {
  mcpFilePendingNotice,
  mcpScopePendingNotice,
  mcpWriteRefusal,
  migratePendingKeptProjects,
} from '../mcp-write-refusal'

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
      `MCP servers stay off here until OpenWaggle has updated ${FILE}: fix it (Unexpected token).`,
    )
  })

  it('names the file once when the error already names it', () => {
    const error = `${FILE}: ${FILE.replace('/mcp.json', '')} links to a missing folder`
    const occurrences = (notice: string) => notice.split(FILE).length - 1

    const scope = mcpScopePendingNotice(pending({ error }))
    const file = mcpFilePendingNotice(pending({ error }))

    expect(scope).toBe(`MCP servers stay off here until an MCP file is fixed. Fix it: ${error}.`)
    expect(occurrences(scope)).toBe(1)
    expect(file).toBe(`An MCP file was not loaded, so its servers stay off. Fix it: ${error}.`)
    expect(occurrences(file)).toBe(1)
  })

  it('names both files when the one to fix is another, such as the old state', () => {
    const state = '/home/user/.openwaggle/mcp/state.json'

    expect(mcpScopePendingNotice(pending({ source: state, error: 'Unexpected token' }))).toBe(
      `MCP servers stay off here until OpenWaggle has updated ${FILE}: Fix ${state} (Unexpected token).`,
    )
  })
})

describe('migrating kept projects again before a global write', () => {
  it('stops at the first lock wait and says to try again shortly, not waiting for each', async () => {
    const failing = (projectPath: string, overrides: Partial<PendingMcpFileMigration> = {}) => ({
      projectPath,
      pending: pending({ path: `${projectPath}/.openwaggle/mcp.json`, ...overrides }),
    })
    let current = [failing('/a'), failing('/b')]
    const migrate = vi.fn(async (projectPath: string | null) => {
      // Another process keeps the migration lock past the wait.
      if (projectPath === '/a') current = [failing('/a', { cause: 'wait' }), failing('/b')]
    })

    const waited = await migratePendingKeptProjects('global', migrate, () => current)

    expect(migrate).toHaveBeenCalledTimes(1)
    expect(mcpWriteRefusal(waited)?.message).toContain('try again shortly')
  })
})
