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

import { createLocalSessionCliClientInput } from '../local-session-cli-client'
import { parseMcpCliArguments } from '../mcp-cli-arguments'

describe('local Sessions CLI client credentials', () => {
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
})
