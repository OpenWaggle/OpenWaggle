import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))

const { inspectMcpServer } = await import('../pi-mcp-server-runtime-service')
const { forgetMcpFileMigrationOutcomes, recordMcpFileMigrationOutcome } = await import(
  '../../../mcp/migration/migration-health'
)

const roots: string[] = []

afterEach(() => {
  forgetMcpFileMigrationOutcomes()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Check connection of a server whose file is left out', () => {
  it('says why that file is not loaded, while the rest of the scope connects', async () => {
    const project = mkdtempSync(path.join(tmpdir(), 'ow-mcp-left-out-'))
    roots.push(project)
    const projectFile = path.join(project, '.openwaggle', 'mcp.json')
    mkdirSync(path.dirname(projectFile), { recursive: true })
    writeFileSync(projectFile, JSON.stringify({ mcpServers: { local: { command: 'local-mcp' } } }))
    // Added after the first run: its migration only converts the format, so the scope stays open.
    recordMcpFileMigrationOutcome(projectFile, 'EACCES: permission denied', {
      keepsLegacyState: false,
    })

    const inspection = await inspectMcpServer(
      { projectPath: project, name: 'local' },
      { homeDir: homedir(), piAgentDir: path.join(homedir(), '.pi', 'agent') },
    )

    expect(inspection.state).toBe('failed')
    expect(inspection.error).toContain(`${projectFile} was not loaded`)
    expect(inspection.error).toContain('EACCES: permission denied')
  })
})
