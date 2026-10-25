import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MockEnvironment {
  OPENWAGGLE_AGENT_RUN?: '1'
  OPENWAGGLE_PROFILE?: string
  OPENWAGGLE_PROFILE_CREDENTIAL_FILE?: string
}

const mocks = vi.hoisted(() => {
  const environment: MockEnvironment = {}
  return {
    ensureHost: vi.fn(async () => undefined),
    env: environment,
    preparePaths: vi.fn(async (paths: object) => paths),
    readCredentialFile: vi.fn(async () => 'file-credential'),
    readCredentialStdin: vi.fn(async () => 'stdin-credential'),
    readStoredCredential: vi.fn(async () => 'stored-credential'),
    refreshEndpoint: vi.fn(async (paths: object) => paths),
    resolvePaths: vi.fn(() => ({ stateRoot: '/state', endpoint: '/state/host.sock' })),
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/user-data'),
    getVersion: vi.fn(() => 'test-version'),
  },
}))
vi.mock('../env', () => ({ env: mocks.env }))
vi.mock('../mcp-cli-arguments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mcp-cli-arguments')>()
  return { ...actual, readSecretFromStdin: mocks.readCredentialStdin }
})
vi.mock('../session-host/local-session-host-launcher', () => ({
  ensureLocalSessionHost: mocks.ensureHost,
}))
vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: mocks.preparePaths,
  refreshLocalSessionHostEndpoint: mocks.refreshEndpoint,
  resolveLocalSessionHostPaths: mocks.resolvePaths,
}))
vi.mock('../session-host/profile-credential-destination', () => ({
  readProfileCredentialFile: mocks.readCredentialFile,
  readStoredProfileCredential: mocks.readStoredCredential,
}))

import { CliError } from '../cli-error'
import {
  createLocalSessionCliClientInput,
  prepareLocalSessionCliClientInput,
  refusedCredentialError,
} from '../local-session-cli-client'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import {
  LocalSessionClientProtocolError,
  LocalSessionHostUnavailableError,
} from '../session-host/local-session-client-protocol-error'

describe('local Hive CLI client credentials', () => {
  beforeEach(() => {
    mocks.env.OPENWAGGLE_AGENT_RUN = undefined
    mocks.env.OPENWAGGLE_PROFILE = undefined
    mocks.env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE = undefined
    mocks.ensureHost.mockClear()
    mocks.preparePaths.mockClear()
    mocks.readCredentialFile.mockClear()
    mocks.readCredentialStdin.mockClear()
    mocks.readStoredCredential.mockClear()
  })

  it.each([['--credential-stdin'], ['--profile-credential-file', '/tmp/helper.credential']])(
    'rejects %s when no profile resolves',
    async (...credentialArguments) => {
      const arguments_ = parseMcpCliArguments(credentialArguments)

      await expect(createLocalSessionCliClientInput(arguments_)).rejects.toThrow(
        'Profile credentials require --profile or OPENWAGGLE_PROFILE',
      )

      expect(mocks.preparePaths).not.toHaveBeenCalled()
      expect(mocks.readCredentialFile).not.toHaveBeenCalled()
      expect(mocks.readCredentialStdin).not.toHaveBeenCalled()
      expect(mocks.ensureHost).not.toHaveBeenCalled()
    },
  )

  it('rejects a credential file from the environment when its profile is absent', async () => {
    mocks.env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE = '/tmp/helper.credential'

    await expect(createLocalSessionCliClientInput(parseMcpCliArguments([]))).rejects.toThrow(
      'Profile credentials require --profile or OPENWAGGLE_PROFILE',
    )

    expect(mocks.preparePaths).not.toHaveBeenCalled()
    expect(mocks.readCredentialFile).not.toHaveBeenCalled()
  })

  it('accepts an explicit credential source with a profile from the environment', async () => {
    mocks.env.OPENWAGGLE_PROFILE = 'helper'

    await expect(
      createLocalSessionCliClientInput(parseMcpCliArguments(['--credential-stdin'])),
    ).resolves.toMatchObject({ profile: 'helper', profileCredential: 'stdin-credential' })

    expect(mocks.readCredentialStdin).toHaveBeenCalledOnce()
    expect(mocks.ensureHost).toHaveBeenCalledOnce()
  })

  it('prepares a client for read-only commands without starting the Session Host', async () => {
    const input = await prepareLocalSessionCliClientInput(parseMcpCliArguments([]))

    expect(input.clientKind).toBe('cli')
    expect(mocks.ensureHost).not.toHaveBeenCalled()
    await createLocalSessionCliClientInput(parseMcpCliArguments([]))
    expect(mocks.ensureHost).toHaveBeenCalledTimes(1)
  })

  it('refuses an agent Run without a profile as an authorization error (#351)', async () => {
    mocks.env.OPENWAGGLE_AGENT_RUN = '1'

    const refusal = await createLocalSessionCliClientInput(parseMcpCliArguments([])).catch(
      (error: unknown) => error,
    )
    const custom = await prepareLocalSessionCliClientInput(parseMcpCliArguments([]), {
      agentRefusal: 'Agents cannot update OpenWaggle.',
    }).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(CliError)
    expect(refusal).toMatchObject({
      kind: 'authorization',
      message:
        'OpenWaggle agents must use their native Hive tool or an explicit named CLI profile.',
    })
    expect(custom).toMatchObject({
      kind: 'authorization',
      message: 'Agents cannot update OpenWaggle.',
    })
    expect(mocks.ensureHost).not.toHaveBeenCalled()
    await expect(
      createLocalSessionCliClientInput(parseMcpCliArguments(['--profile', 'helper'])),
    ).resolves.toMatchObject({ profile: 'helper' })
  })

  it('names the profile and its source when its credential cannot be read', async () => {
    mocks.readCredentialFile.mockRejectedValueOnce(new Error('ENOENT: no such file'))

    await expect(
      createLocalSessionCliClientInput(
        parseMcpCliArguments(['--profile', 'helper', '--profile-credential-file', '/x/helper']),
      ),
    ).rejects.toMatchObject({
      kind: 'authentication',
      message:
        'Could not read the credential for access profile "helper" from "/x/helper": ENOENT: no such file',
    })
  })

  it('says which credential the Host refused, for a stale or revoked profile', async () => {
    mocks.ensureHost.mockRejectedValueOnce(
      new LocalSessionClientProtocolError('authentication_failed', 'Authentication failed.'),
    )

    await expect(
      createLocalSessionCliClientInput(parseMcpCliArguments(['--profile', 'helper'])),
    ).rejects.toMatchObject({
      kind: 'authentication',
      message: expect.stringContaining(
        'The Session Host refused the credential for access profile "helper" (Authentication failed.)',
      ),
    })
  })

  it('keeps a Host that is starting or slow its own kind instead of blaming the profile', async () => {
    const unavailable = new LocalSessionHostUnavailableError(
      'Timed out starting the Local Session Host.',
    )
    mocks.ensureHost.mockRejectedValueOnce(unavailable)

    await expect(
      createLocalSessionCliClientInput(parseMcpCliArguments(['--profile', 'helper'])),
    ).rejects.toBe(unavailable)
    expect(
      refusedCredentialError(
        { profile: 'helper' },
        new LocalSessionClientProtocolError('host_draining', 'Stopping.'),
      ),
    ).toBeInstanceOf(LocalSessionClientProtocolError)
  })
})
