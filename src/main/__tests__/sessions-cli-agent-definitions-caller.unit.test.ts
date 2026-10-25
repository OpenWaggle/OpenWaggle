import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: { OPENWAGGLE_AGENT_RUN: '1' as const },
}))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/user-data'), getVersion: vi.fn() } }))
vi.mock('../env', () => ({ env: mocks.env }))

const { runAgentDefinitionDiscoveryCommand } = await import('../sessions-cli-agent-definitions')
const { parseMcpCliArguments } = await import('../mcp-cli-arguments')

function discover(
  args: readonly string[],
  io: Parameters<typeof runAgentDefinitionDiscoveryCommand>[2],
) {
  const parsed = parseMcpCliArguments(args)
  return runAgentDefinitionDiscoveryCommand(
    parsed.positionals[0] ?? '',
    { ...parsed, positionals: parsed.positionals.slice(1) },
    io,
  )
}

describe('hive agent-definitions-* as Hive commands (#351)', () => {
  it('refuses an agent Run without a named profile, like every Hive command', async () => {
    const resolveProject = vi.fn()

    await expect(discover(['agent-definitions-list'], { resolveProject })).rejects.toMatchObject({
      kind: 'authorization',
      message:
        'OpenWaggle agents must use their native Hive tool or an explicit named CLI profile.',
    })
    expect(resolveProject).not.toHaveBeenCalled()
  })

  it('checks the caller, then says when there is nothing to list', async () => {
    const stdout: string[] = []
    const verifyCaller = vi.fn(async () => undefined)

    await expect(
      discover(['agent-definitions-list', '--profile', 'helper'], {
        cwd: '/project',
        home: '/home',
        stdout: (value) => void stdout.push(value),
        verifyCaller,
        resolveProject: async (projectPath) => ({ projectPath, enabledByName: {} }),
      }),
    ).resolves.toBe(0)

    expect(verifyCaller).toHaveBeenCalledWith(
      expect.objectContaining({ options: new Map([['profile', ['helper']]]) }),
    )
    expect(stdout.join('')).toBe('No Agent definitions found.\n')
  })
})
