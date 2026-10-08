import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliResult } from '../cli-runner'

const { runCliMock, readHostsMock } = vi.hoisted(() => ({
  runCliMock: vi.fn(),
  readHostsMock: vi.fn(),
}))

vi.mock('../cli-runner', () => ({ runCli: runCliMock }))
vi.mock('../../../services/source-control/cli-host-config', () => ({
  readSourceControlCliHosts: readHostsMock,
}))

const { createGithubAccountRunner } = await import('../github-account-runner')

function cli(partial: Partial<CliResult>): CliResult {
  return { stdout: '', stderr: '', code: 0, missing: false, ...partial }
}

const REPO_NOT_FOUND = cli({
  code: 1,
  stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/app'. (repository)",
})

function accounts(...logins: [string, boolean][]) {
  readHostsMock.mockResolvedValue({
    github: [
      { host: 'github.com', accounts: logins.map(([login, active]) => ({ login, active })) },
    ],
    gitlab: [],
  })
}

function tokenEnv(call: unknown[]) {
  const options = call[3]
  return typeof options === 'object' && options !== null && 'env' in options
    ? options.env
    : undefined
}

describe('choosing the GitHub account that can see a repository', () => {
  beforeEach(() => {
    runCliMock.mockReset()
    readHostsMock.mockReset()
  })

  it('uses the active account first and reports it', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock.mockResolvedValueOnce(cli({ stdout: '{}' }))
    const remember = vi.fn(async () => undefined)
    const runner = createGithubAccountRunner('github.com', { preferredLogin: null, remember })

    await expect(runner.run(['pr', 'view', '1'], '/work')).resolves.toMatchObject({ code: 0 })

    expect(runCliMock).toHaveBeenCalledTimes(1)
    expect(tokenEnv(runCliMock.mock.calls[0] ?? [])).toBeUndefined()
    expect(runner.account()).toBe('jdoe')
    expect(remember).not.toHaveBeenCalled()
  })

  it('retries with another account token when the repository is not visible, and remembers it', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock
      .mockResolvedValueOnce(REPO_NOT_FOUND)
      .mockResolvedValueOnce(cli({ stdout: 'gho_acme_token\n' }))
      .mockResolvedValueOnce(cli({ stdout: '{"number":1}' }))
    const remember = vi.fn(async () => undefined)
    const runner = createGithubAccountRunner('github.com', { preferredLogin: null, remember })

    await expect(runner.run(['pr', 'view', '1'], '/work')).resolves.toMatchObject({
      code: 0,
      stdout: '{"number":1}',
    })

    expect(runCliMock.mock.calls[1]?.slice(0, 2)).toEqual([
      'gh',
      ['auth', 'token', '--hostname', 'github.com', '--user', 'jdoe_acme'],
    ])
    expect(tokenEnv(runCliMock.mock.calls[2] ?? [])).toMatchObject({ GH_TOKEN: 'gho_acme_token' })
    expect(runner.account()).toBe('jdoe_acme')
    expect(remember).toHaveBeenCalledWith('jdoe_acme')
  })

  it('starts with the remembered account and keeps using it', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'gho_acme_token\n' }))
      .mockResolvedValueOnce(cli({ stdout: '{}' }))
      .mockResolvedValueOnce(cli({ stdout: '[]' }))
    const runner = createGithubAccountRunner('github.com', {
      preferredLogin: 'jdoe_acme',
      remember: async () => undefined,
    })

    await runner.run(['pr', 'view', '1'], '/work')
    await runner.run(['pr', 'list'], '/work')

    expect(runCliMock).toHaveBeenCalledTimes(3)
    expect(tokenEnv(runCliMock.mock.calls[2] ?? [])).toMatchObject({ GH_TOKEN: 'gho_acme_token' })
  })

  it('does not switch accounts when the branch simply has no pull request', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock.mockResolvedValueOnce(
      cli({ code: 1, stderr: 'no pull requests found for branch "feature"' }),
    )
    const runner = createGithubAccountRunner('github.com', {
      preferredLogin: null,
      remember: async () => undefined,
    })

    await expect(runner.run(['pr', 'view', 'feature'], '/work')).resolves.toMatchObject({ code: 1 })
    expect(runCliMock).toHaveBeenCalledTimes(1)
    expect(runner.unreachableBy()).toBeNull()
  })

  it('reports every account it tried when none can see the repository', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock
      .mockResolvedValueOnce(REPO_NOT_FOUND)
      .mockResolvedValueOnce(cli({ stdout: 'gho_acme_token\n' }))
      .mockResolvedValueOnce(REPO_NOT_FOUND)
    const runner = createGithubAccountRunner('github.com', {
      preferredLogin: null,
      remember: async () => undefined,
    })

    await expect(runner.run(['pr', 'view', '1'], '/work')).resolves.toMatchObject({ code: 1 })
    expect(runner.unreachableBy()).toEqual(['jdoe', 'jdoe_acme'])
  })

  it('uses GH_ENTERPRISE_TOKEN for an Enterprise Server host', async () => {
    readHostsMock.mockResolvedValue({
      github: [
        {
          host: 'ghe.acme.io',
          accounts: [
            { login: 'jdoe', active: true },
            { login: 'svc', active: false },
          ],
        },
      ],
      gitlab: [],
    })
    runCliMock
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'HTTP 404: Not Found' }))
      .mockResolvedValueOnce(cli({ stdout: 'ghe_token\n' }))
      .mockResolvedValueOnce(cli({ stdout: '{}' }))
    const runner = createGithubAccountRunner('ghe.acme.io', {
      preferredLogin: null,
      remember: async () => undefined,
    })

    await runner.run(['pr', 'view', '1'], '/work')

    expect(tokenEnv(runCliMock.mock.calls[2] ?? [])).toMatchObject({
      GH_ENTERPRISE_TOKEN: 'ghe_token',
    })
  })

  it('runs a write once, as the account an earlier read chose', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock
      .mockResolvedValueOnce(REPO_NOT_FOUND)
      .mockResolvedValueOnce(cli({ stdout: 'gho_acme_token\n' }))
      .mockResolvedValueOnce(cli({ stdout: '{"number":1}' }))
      .mockResolvedValueOnce(REPO_NOT_FOUND)
    const runner = createGithubAccountRunner('github.com', {
      preferredLogin: null,
      remember: async () => undefined,
    })
    await runner.run(['pr', 'view', '1'], '/work')

    await expect(runner.runWrite(['pr', 'merge', '1'], '/work')).resolves.toBe(REPO_NOT_FOUND)

    expect(runCliMock).toHaveBeenCalledTimes(4)
    expect(tokenEnv(runCliMock.mock.calls[3] ?? [])).toMatchObject({ GH_TOKEN: 'gho_acme_token' })
  })

  it('runs a write once, as the remembered account, when nothing was read first', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'gho_acme_token\n' }))
      .mockResolvedValueOnce(REPO_NOT_FOUND)
    const runner = createGithubAccountRunner('github.com', {
      preferredLogin: 'jdoe_acme',
      remember: async () => undefined,
    })

    await expect(runner.runWrite(['pr', 'create'], '/work')).resolves.toBe(REPO_NOT_FOUND)

    expect(runCliMock).toHaveBeenCalledTimes(2)
    expect(tokenEnv(runCliMock.mock.calls[1] ?? [])).toMatchObject({ GH_TOKEN: 'gho_acme_token' })
    expect(runner.account()).toBe('jdoe_acme')
  })

  it('replaces a remembered account that lost access with the one that works', async () => {
    accounts(['jdoe', true], ['jdoe_old', false])
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'gho_old\n' }))
      .mockResolvedValueOnce(REPO_NOT_FOUND)
      .mockResolvedValueOnce(cli({ stdout: '{}' }))
    const remember = vi.fn(async () => undefined)
    const runner = createGithubAccountRunner('github.com', { preferredLogin: 'jdoe_old', remember })

    await runner.run(['pr', 'view', '1'], '/work')

    expect(remember).toHaveBeenCalledWith('jdoe')
  })

  it('does not ask the account a command just refused again', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: '{}' }))
      .mockResolvedValueOnce(REPO_NOT_FOUND)
      .mockResolvedValueOnce(cli({ stdout: 'gho_acme_token\n' }))
      .mockResolvedValueOnce(REPO_NOT_FOUND)
    const runner = createGithubAccountRunner('github.com', {
      preferredLogin: null,
      remember: async () => undefined,
    })
    await runner.run(['pr', 'view', '1'], '/work')

    await runner.run(['repo', 'view', 'acme/other'], '/work')

    expect(runCliMock).toHaveBeenCalledTimes(4)
    expect(runner.unreachableBy()).toEqual(['jdoe', 'jdoe_acme'])
  })

  it('refuses a write rather than run it as another account when a token cannot be read', async () => {
    accounts(['jdoe', true], ['jdoe_acme', false])
    runCliMock.mockResolvedValueOnce(cli({ code: 1, stderr: 'no token' }))
    const runner = createGithubAccountRunner('github.com', {
      preferredLogin: 'jdoe_acme',
      remember: async () => undefined,
    })

    await expect(runner.runWrite(['pr', 'create'], '/work')).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('@jdoe_acme'),
    })
    expect(runCliMock).toHaveBeenCalledTimes(1)
  })
})
