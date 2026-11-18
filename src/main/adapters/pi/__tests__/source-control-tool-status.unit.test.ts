import { describe, expect, it } from 'vitest'
import {
  GITLAB_REPOSITORY,
  PROJECT_ROOT,
  resolvedGitlab,
  sourceControlToolHarness,
  WORKING_PATH,
} from './source-control-tool.test-harness'

describe('source_control status', () => {
  it('reports the remote, the decided host provider and how, and the repository', async () => {
    const { run, backend } = sourceControlToolHarness()

    const result = await run({ action: 'status' })

    expect(result).not.toHaveProperty('isError')
    expect(result.details).toMatchObject({
      remote: { name: 'origin', url: 'git@git.acme.io:Platform/Web/App.git' },
      host: { host: 'git.acme.io', provider: 'gitlab', source: 'cli-sign-in' },
      repository: 'git.acme.io/platform/web/app',
    })
    expect(backend.openWorkingTree).toHaveBeenCalledWith(WORKING_PATH, expect.anything(), {
      probeRemote: true,
      projectPath: PROJECT_ROOT,
    })
  })

  it("reports the host's CLI, its signed-in accounts, and the repository's remembered account", async () => {
    const { run } = sourceControlToolHarness({
      hosts: {
        hosts: [
          {
            host: 'git.acme.io',
            provider: 'gitlab',
            source: 'cli-sign-in',
            cli: 'glab',
            cliInstalled: true,
            unsupported: false,
            accounts: [
              { login: 'dana', active: true },
              { login: 'dana-bot', active: false },
            ],
          },
        ],
        cliInstalled: { gh: false, glab: true },
      },
      settings: {
        sourceControlRepositoryAccounts: { 'git.acme.io/platform/web/app': 'dana-bot' },
      },
    })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({
      cli: { name: 'glab', installed: true },
      accounts: [
        { login: 'dana', active: true },
        { login: 'dana-bot', active: false },
      ],
      rememberedAccount: 'dana-bot',
    })
  })

  it("reports the current branch's change request", async () => {
    const { run, backend } = sourceControlToolHarness({
      changeRequest: {
        ok: true,
        changeRequest: {
          title: 'Add login',
          url: 'https://git.acme.io/platform/web/app/-/merge_requests/7',
          baseRef: 'main',
          headRef: 'feature',
          state: 'open',
        },
      },
      providerAccount: 'dana',
    })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({
      branch: 'feature',
      changeRequest: {
        url: 'https://git.acme.io/platform/web/app/-/merge_requests/7',
        title: 'Add login',
        state: 'open',
        account: 'dana',
      },
      attention: null,
    })
    expect(backend.findCurrentChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ repository: GITLAB_REPOSITORY }),
      WORKING_PATH,
      'feature',
      expect.anything(),
    )
  })

  it('tells the agent the user must sign in when the change request lookup is unauthenticated', async () => {
    const { run } = sourceControlToolHarness({
      changeRequest: {
        ok: false,
        code: 'not-authenticated',
        message: 'glab: not logged in',
        attention: {
          kind: 'not-signed-in',
          provider: 'gitlab',
          host: 'git.acme.io',
          cli: 'glab',
          environmentTokenIgnored: false,
          ignoredTokenVariables: [],
        },
      },
    })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({
      changeRequest: null,
      attention: { kind: 'not-signed-in', provider: 'gitlab', host: 'git.acme.io', cli: 'glab' },
    })
    const text = JSON.stringify(result.details)
    expect(text).toContain('Sign in')
    expect(text).toContain('Session Summary')
    expect(text).toContain('glab auth login --hostname git.acme.io')
  })

  it('names the ignored token variables when the environment holds some', async () => {
    const { run } = sourceControlToolHarness({
      changeRequest: {
        ok: false,
        code: 'not-authenticated',
        message: 'not logged in',
        attention: {
          kind: 'not-signed-in',
          provider: 'gitlab',
          host: 'git.acme.io',
          cli: 'glab',
          environmentTokenIgnored: true,
          ignoredTokenVariables: ['GITLAB_TOKEN', 'GL_TOKEN'],
        },
      },
    })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({
      nextStep: expect.stringContaining('GITLAB_TOKEN, GL_TOKEN'),
    })
  })

  it('suggests a plain sign-in command when the host is not a valid hostname', async () => {
    const { run } = sourceControlToolHarness({
      changeRequest: {
        ok: false,
        code: 'not-authenticated',
        message: 'not logged in',
        attention: {
          kind: 'not-signed-in',
          provider: 'github',
          host: 'bad host;rm',
          cli: 'gh',
          environmentTokenIgnored: false,
          ignoredTokenVariables: [],
        },
      },
    })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({ nextStep: expect.stringContaining('`gh auth login`') })
  })

  it('reports the effective change request open destination and where it came from', async () => {
    const { run, backend } = sourceControlToolHarness()
    backend.resolveOpenDestination.mockResolvedValueOnce({
      destination: 'website',
      source: 'project-shared',
    })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({
      openDestination: { destination: 'website', source: 'project-shared' },
    })
    expect(backend.resolveOpenDestination).toHaveBeenCalledWith(PROJECT_ROOT, expect.anything())
  })

  it('asks for a provider choice when the host is undecided', async () => {
    const { run, backend } = sourceControlToolHarness({
      resolution: {
        kind: 'undecided',
        remote: { name: 'origin', url: 'https://code.internal/team/app.git' },
        hostState: { host: 'code.internal', provider: null, source: null },
        attention: { kind: 'choose-provider', host: 'code.internal' },
      },
    })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({
      host: { host: 'code.internal', provider: null, source: null },
      repository: null,
      cli: null,
      changeRequest: null,
      attention: { kind: 'choose-provider', host: 'code.internal' },
      nextStep: expect.stringContaining('set-host-provider'),
    })
    expect(backend.findCurrentChangeRequest).not.toHaveBeenCalled()
  })

  it('never echoes credentials embedded in the remote URL', async () => {
    const { run } = sourceControlToolHarness({
      resolution: resolvedGitlab({
        remote: {
          name: 'origin',
          url: 'https://dana:glpat-SECRET@git.acme.io/platform/web/app.git',
        },
      }),
    })

    const result = await run({ action: 'status' })

    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result.details).toMatchObject({
      remote: { name: 'origin', url: 'https://git.acme.io/platform/web/app.git' },
    })
  })

  it('never echoes a token used as the remote URL username', async () => {
    const { run } = sourceControlToolHarness({
      resolution: resolvedGitlab({
        remote: { name: 'origin', url: 'https://ghp_SECRETSECRETSECRETSECRET1234@github.com/o/r' },
      }),
    })

    const result = await run({ action: 'status' })

    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result.details).toMatchObject({ remote: { url: 'https://github.com/o/r' } })
  })

  it('redacts credentials in CLI error text it reports', async () => {
    const { run } = sourceControlToolHarness({
      changeRequest: {
        ok: false,
        code: 'unknown',
        message:
          'fatal: https://oauth2:glpat-SECRETSECRETSECRET1234@git.acme.io/a/b.git failed; token glpat-SECRETSECRETSECRET5678 rejected',
      },
    })

    const result = await run({ action: 'status' })

    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result.details).toMatchObject({
      changeRequestError: expect.stringContaining('https://git.acme.io/a/b.git failed'),
    })
  })

  it('still reports hosts and the open destination when the working tree cannot be resolved', async () => {
    const { run, backend } = sourceControlToolHarness()
    backend.openWorkingTree.mockRejectedValueOnce(new Error('git exploded'))

    const result = await run({ action: 'status' })

    expect(result).not.toHaveProperty('isError')
    expect(result.details).toMatchObject({
      remote: null,
      host: null,
      repository: null,
      openDestination: { destination: 'inspector', source: 'default' },
      error: expect.stringContaining('git exploded'),
    })
  })

  it('still reports the repository when the host list or open destination cannot be read', async () => {
    const { run, backend } = sourceControlToolHarness()
    backend.listHosts.mockRejectedValueOnce(new Error('hosts.yml unreadable'))
    backend.resolveOpenDestination.mockRejectedValueOnce(new Error('settings unreadable'))

    const result = await run({ action: 'status' })

    expect(result).not.toHaveProperty('isError')
    expect(result.details).toMatchObject({
      repository: 'git.acme.io/platform/web/app',
      host: { host: 'git.acme.io', provider: 'gitlab' },
      cli: { name: 'glab', installed: null },
      accounts: [],
      openDestination: null,
      error: expect.stringMatching(/hosts\.yml unreadable.*settings unreadable/u),
    })
  })

  it('still reports the repository when the change request lookup throws', async () => {
    const { run, backend } = sourceControlToolHarness()
    backend.findCurrentChangeRequest.mockRejectedValueOnce(
      new Error('glab crashed with glpat-SECRETSECRETSECRET1234'),
    )

    const result = await run({ action: 'status' })

    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result.details).toMatchObject({
      repository: 'git.acme.io/platform/web/app',
      changeRequest: null,
      error: expect.stringContaining('glab crashed'),
    })
  })

  it('reports a working tree without a remote', async () => {
    const { run } = sourceControlToolHarness({ resolution: { kind: 'no-remote' } })

    const result = await run({ action: 'status' })

    expect(result.details).toMatchObject({
      remote: null,
      host: null,
      repository: null,
      attention: null,
      nextStep: null,
    })
  })
})
