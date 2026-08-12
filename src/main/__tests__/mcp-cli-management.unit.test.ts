import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { runMcpManagementCommand } from '../mcp-cli-management'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
}))

let home = ''

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'ow-mcp-cli-mgmt-'))
  vi.stubEnv('HOME', home)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('runMcpManagementCommand (shared Layer graph)', () => {
  it('runs the config service through the composed MCP Layer graph for list', async () => {
    const view = await runMcpManagementCommand('list', parseMcpCliArguments(['--project', home]))
    expect(view).toMatchObject({
      integration: { desired: { effective: 'off' } },
      servers: [],
    })
  })

  it('adds a server through the shared config service and reports it back', async () => {
    const added = await runMcpManagementCommand(
      'add',
      parseMcpCliArguments([
        'docs',
        '--url',
        'https://docs.example.com/mcp',
        '--scope',
        'global',
        '--project',
        home,
      ]),
    )
    expect(added).toMatchObject({
      servers: expect.arrayContaining([expect.objectContaining({ name: 'docs' })]),
    })

    const listed = await runMcpManagementCommand('list', parseMcpCliArguments(['--project', home]))
    expect(listed).toMatchObject({
      servers: expect.arrayContaining([expect.objectContaining({ name: 'docs' })]),
    })
  })
})
