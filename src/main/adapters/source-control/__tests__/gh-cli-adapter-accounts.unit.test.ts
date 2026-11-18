import type { SourceControlRepositoryIdentity } from '@shared/types/git'
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

const { getSourceControlProvider } = await import('../index')

const REPOSITORY = {
  provider: 'github',
  host: 'github.acme.io',
  owner: 'acme',
  repository: 'private-app',
} satisfies SourceControlRepositoryIdentity

const REPO_NOT_FOUND: CliResult = {
  stdout: '',
  stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/private-app'.",
  code: 1,
  missing: false,
}

describe('GitHub repositories no signed-in account can see', () => {
  beforeEach(() => {
    runCliMock.mockReset().mockResolvedValue(REPO_NOT_FOUND)
    readHostsMock.mockReset()
  })

  it('names the single signed-in account that cannot see the repository', async () => {
    readHostsMock.mockResolvedValue({
      github: [{ host: 'github.acme.io', accounts: [{ login: 'jdoe', active: true }] }],
      gitlab: [],
    })
    const provider = getSourceControlProvider('github', REPOSITORY, {
      accountPreference: { preferredLogin: null, remember: async () => undefined },
    })

    await expect(provider?.listChangeRequests('/work')).resolves.toMatchObject({
      ok: false,
      attention: {
        kind: 'no-account-access',
        host: 'github.acme.io',
        repository: 'acme/private-app',
        accounts: ['jdoe'],
      },
    })
  })
})
