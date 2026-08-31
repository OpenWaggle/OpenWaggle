import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { runMcpManagementCommand } from '../mcp-cli-management'

const { authorizeMcpServerMock, logoutMcpOAuthMock } = vi.hoisted(() => ({
  authorizeMcpServerMock: vi.fn(),
  logoutMcpOAuthMock: vi.fn(),
}))

vi.mock('../adapters/mcp/oauth-provider', () => ({
  authorizeMcpServer: authorizeMcpServerMock,
  logoutMcpOAuth: logoutMcpOAuthMock,
}))

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

let home = ''

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'ow-mcp-cli-mgmt-'))
  vi.stubEnv('HOME', home)
  authorizeMcpServerMock.mockReset()
  authorizeMcpServerMock.mockResolvedValue({ authorized: true, browserOpened: false })
  logoutMcpOAuthMock.mockReset()
  logoutMcpOAuthMock.mockImplementation(
    async (input: { instanceId: string; vault: { remove(name: string): Promise<unknown> } }) =>
      input.vault.remove(`oauth.${input.instanceId}`),
  )
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('runMcpManagementCommand (shared Layer graph)', () => {
  const reconcileOwnerRuntime = vi.fn(async () => undefined)

  beforeEach(() => {
    reconcileOwnerRuntime.mockReset()
    reconcileOwnerRuntime.mockResolvedValue(undefined)
  })

  it('runs the config service through the composed MCP Layer graph for list', async () => {
    const view = await runMcpManagementCommand('list', parseMcpCliArguments(['--project', home]), {
      reconcileOwnerRuntime,
    })
    expect(view).toMatchObject({
      integration: { desired: { effective: 'off' } },
      servers: [],
    })
    expect(reconcileOwnerRuntime).not.toHaveBeenCalled()
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
      { reconcileOwnerRuntime },
    )
    expect(added).toMatchObject({
      servers: expect.arrayContaining([expect.objectContaining({ name: 'docs' })]),
    })

    expect(reconcileOwnerRuntime).toHaveBeenCalledWith(expect.anything(), home)

    const listed = await runMcpManagementCommand(
      'list',
      parseMcpCliArguments(['--project', home]),
      { reconcileOwnerRuntime },
    )
    expect(listed).toMatchObject({
      servers: expect.arrayContaining([expect.objectContaining({ name: 'docs' })]),
    })
  })

  it('preflights the current owner protocol before a durable mutation', async () => {
    reconcileOwnerRuntime.mockRejectedValueOnce(new Error('Host upgrade is still draining'))

    await expect(
      runMcpManagementCommand(
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
        { reconcileOwnerRuntime },
      ),
    ).rejects.toThrow('Host upgrade is still draining')

    const listed = await runMcpManagementCommand(
      'list',
      parseMcpCliArguments(['--project', home]),
      { reconcileOwnerRuntime },
    )
    expect(listed).toMatchObject({ servers: [] })
  })

  it('notifies the owning Host after CLI credential removal', async () => {
    await runMcpManagementCommand(
      'add',
      parseMcpCliArguments([
        'private-docs',
        '--url',
        'https://docs.example.com/mcp',
        '--oauth',
        '--scope',
        'global',
        '--project',
        home,
      ]),
      { reconcileOwnerRuntime },
    )
    reconcileOwnerRuntime.mockClear()

    await runMcpManagementCommand(
      'logout',
      parseMcpCliArguments(['private-docs', '--project', home]),
      { reconcileOwnerRuntime },
    )

    expect(reconcileOwnerRuntime).toHaveBeenCalledWith(expect.anything(), home)
  })

  it('retries owner notification when OAuth already persisted authorization', async () => {
    await runMcpManagementCommand(
      'add',
      parseMcpCliArguments([
        'private-docs',
        '--url',
        'https://docs.example.com/mcp',
        '--oauth',
        '--scope',
        'global',
        '--project',
        home,
      ]),
      { reconcileOwnerRuntime },
    )
    reconcileOwnerRuntime.mockClear()
    reconcileOwnerRuntime
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('owner connection reset'))
      .mockResolvedValue(undefined)
    authorizeMcpServerMock
      .mockImplementationOnce(
        async (input: { vault: { set(name: string, value: string): Promise<unknown> } }) => {
          await input.vault.set('oauth.server-1', 'persisted')
          return { authorized: true, browserOpened: true }
        },
      )
      .mockResolvedValueOnce({ authorized: true, browserOpened: false })
    const authArguments = parseMcpCliArguments(['private-docs', '--project', home])

    await expect(
      runMcpManagementCommand('auth', authArguments, { reconcileOwnerRuntime }),
    ).rejects.toThrow('owner connection reset')
    await expect(
      runMcpManagementCommand('auth', authArguments, { reconcileOwnerRuntime }),
    ).resolves.toEqual({ authorized: true, browserOpened: false })

    expect(reconcileOwnerRuntime).toHaveBeenCalledTimes(4)
  })
})
