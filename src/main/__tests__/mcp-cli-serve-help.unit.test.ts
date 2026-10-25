import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const output = vi.hoisted(() => {
  const stdout: string[] = []
  const env: { OPENWAGGLE_AGENT_RUN?: '1' } = {}
  return { stdout, env }
})

vi.mock('electron', () => ({ app: { getPath: vi.fn(), getVersion: vi.fn(() => 'test') } }))
vi.mock('../env', () => ({ env: output.env }))
vi.mock('../cli-stdout', () => ({
  writeCliStdout: vi.fn(async (text: string) => {
    output.stdout.push(text)
  }),
  routedCliStdoutStream: vi.fn(() => undefined),
}))

const { runMcpCli } = await import('../mcp-cli')

describe('openwaggle mcp serve help (#350)', () => {
  beforeEach(() => {
    output.stdout.length = 0
    output.env.OPENWAGGLE_AGENT_RUN = undefined
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    [['serve', '--help']],
    [['serve', '-h']],
    [['serve', '--stdio', '--help']],
    [['help', 'serve']],
  ])('prints the server options for %j', async (args) => {
    await expect(runMcpCli(args)).resolves.toBe(0)

    expect(output.stdout.join('')).toContain('Authority (exactly one):')
    expect(output.stdout.join('')).toContain('--profile <name>')
    expect(process.stderr.write).not.toHaveBeenCalled()
  })

  it('prints the command list for mcp --help', async () => {
    await expect(runMcpCli(['--help'])).resolves.toBe(0)

    expect(output.stdout.join('')).toContain(
      'openwaggle mcp serve --stdio (--profile <name> | --owner)',
    )
  })

  it('refuses a server without a grant before it starts, as a usage error', async () => {
    await expect(
      runMcpCli(['serve', '--stdio', '--owner', '--workspace', process.cwd()]),
    ).resolves.toBe(2)

    expect(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0])).toContain(
      'error [usage]: Server mode requires at least one --grant <capability>',
    )
  })

  it('refuses --owner inside an agent Run as an authorization error', async () => {
    output.env.OPENWAGGLE_AGENT_RUN = '1'

    await expect(
      runMcpCli(['serve', '--stdio', '--owner', '--grant', 'sessions:read', '--session', 's']),
    ).resolves.toBe(4)

    expect(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0])).toContain(
      'error [authorization]: OpenWaggle agents cannot use --owner',
    )
  })
})
