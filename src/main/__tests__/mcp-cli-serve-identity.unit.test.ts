import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const environment: { OPENWAGGLE_AGENT_RUN?: '1'; OPENWAGGLE_PROFILE_CREDENTIAL_FILE?: string } =
    {}
  return {
    env: environment,
    readCredentialFile: vi.fn(async (_path: string) => 'file-credential'),
    readStoredCredential: vi.fn(async (_input: { stateRoot: string; profileName: string }) =>
      Promise.resolve('stored-credential'),
    ),
  }
})

vi.mock('electron', () => ({ app: { getPath: vi.fn(), getVersion: vi.fn(() => '0.0.0') } }))
vi.mock('../env', () => ({ env: mocks.env }))
vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: vi.fn(async (paths: object) => paths),
  refreshLocalSessionHostEndpoint: vi.fn(async (paths: object) => paths),
  resolveLocalSessionHostPaths: vi.fn(() => ({ stateRoot: '/state' })),
}))
vi.mock('../session-host/profile-credential-destination', () => ({
  readProfileCredentialFile: mocks.readCredentialFile,
  readStoredProfileCredential: mocks.readStoredCredential,
}))

const { parseMcpCliArguments } = await import('../mcp-cli-arguments')
const { parseServeIdentity, resolveServeIdentity } = await import('../mcp-cli-serve-identity')

function parse(args: readonly string[], stdio = true) {
  return parseServeIdentity(parseMcpCliArguments(args), stdio)
}

describe('mcp serve authority (#350)', () => {
  beforeEach(() => {
    mocks.env.OPENWAGGLE_AGENT_RUN = undefined
    mocks.env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE = undefined
    mocks.readCredentialFile.mockClear()
    mocks.readStoredCredential.mockClear()
  })

  it('requires exactly one of --profile or --owner', () => {
    expect(() => parse(['--stdio'])).toThrow('exactly one of --profile <name>')
    expect(() => parse(['--stdio', '--owner', '--profile', 'ci'])).toThrow(
      'exactly one of --profile <name>',
    )
  })

  it('names a profile server by its access profile, never by a label', async () => {
    const { identity } = parse(['--stdio', '--profile', 'ci-helper'])

    expect(identity).toEqual({ kind: 'profile', profile: 'ci-helper' })
    await expect(resolveServeIdentity(identity, '/user-data')).resolves.toEqual({
      kind: 'profile',
      profile: 'ci-helper',
      credential: 'stored-credential',
    })
    expect(mocks.readStoredCredential).toHaveBeenCalledWith({
      stateRoot: '/state',
      profileName: 'ci-helper',
    })
  })

  it('reads a profile credential file from the option or the environment', async () => {
    const fromOption = parse([
      '--stdio',
      '--profile',
      'ci',
      '--profile-credential-file',
      '/secrets/ci',
    ]).identity
    mocks.env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE = '/secrets/env'
    const fromEnvironment = parse(['--stdio', '--profile', 'ci']).identity

    await resolveServeIdentity(fromOption, '/user-data')
    await resolveServeIdentity(fromEnvironment, '/user-data')

    expect(mocks.readCredentialFile.mock.calls.map(([file]) => file)).toEqual([
      '/secrets/ci',
      '/secrets/env',
    ])
    expect(mocks.readStoredCredential).not.toHaveBeenCalled()
  })

  it('reports an unreadable credential store as an authentication error naming the profile', async () => {
    mocks.readStoredCredential.mockRejectedValueOnce(new Error('decryption failed'))

    await expect(
      resolveServeIdentity(parse(['--stdio', '--profile', 'ci']).identity, '/user-data'),
    ).rejects.toMatchObject({
      kind: 'authentication',
      message:
        'Could not read the credential for access profile "ci" from the credential store: decryption failed',
    })
  })

  it('keeps the authorization ceiling an owner-only option', () => {
    expect(() =>
      parse(['--stdio', '--profile', 'ci', '--authorization-ceiling', 'ask-for-approval']),
    ).toThrow('--authorization-ceiling applies only with --owner')
    expect(() => parse(['--stdio', '--owner', '--profile-credential-file', '/x'])).toThrow(
      'requires --profile <name>',
    )
    mocks.env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE = '/secrets/env'
    expect(() => parse(['--stdio', '--owner'])).toThrow('requires --profile <name>')
    mocks.env.OPENWAGGLE_PROFILE_CREDENTIAL_FILE = undefined
    expect(
      parse(['--http', '0', '--owner', '--authorization-ceiling', 'yolo'], false).identity,
    ).toEqual({
      kind: 'owner',
      label: 'local-http',
      authorizationCeiling: 'yolo',
    })
    expect(parse(['--stdio', '--owner']).identity).toEqual({
      kind: 'owner',
      label: 'local-stdio',
      authorizationCeiling: 'ask-for-approval',
    })
  })

  it('refuses --owner inside an OpenWaggle agent Run but allows a named profile', () => {
    mocks.env.OPENWAGGLE_AGENT_RUN = '1'

    expect(() => parse(['--stdio', '--owner'])).toThrow(
      'OpenWaggle agents cannot use --owner: use the native Hive tool or --profile <name>.',
    )
    expect(parse(['--stdio', '--profile', 'ci']).identity).toEqual({
      kind: 'profile',
      profile: 'ci',
    })
  })
})
