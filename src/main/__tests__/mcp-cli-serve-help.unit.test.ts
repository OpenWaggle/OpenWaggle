import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const output = vi.hoisted(() => {
  const stdout: string[] = []
  return { stdout }
})

vi.mock('electron', () => ({ app: { getPath: vi.fn(), getVersion: vi.fn(() => 'test') } }))
vi.mock('../env', () => ({ env: {} }))
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

  it('refuses a server without a grant before it starts', async () => {
    await expect(
      runMcpCli(['serve', '--stdio', '--owner', '--workspace', process.cwd()]),
    ).resolves.not.toBe(0)

    expect(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0])).toContain(
      'Server mode requires at least one --grant <capability>',
    )
  })
})
