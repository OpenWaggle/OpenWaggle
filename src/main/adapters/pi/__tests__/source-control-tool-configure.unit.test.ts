import { describe, expect, it } from 'vitest'
import {
  PROJECT_ROOT,
  sourceControlToolHarness,
  WORKING_PATH,
} from './source-control-tool.test-harness'

describe('source_control configure', () => {
  it('sets a host provider after the user authorizes it', async () => {
    const { run, backend, authorize } = sourceControlToolHarness()

    const result = await run({
      action: 'configure',
      change: 'set-host-provider',
      host: 'git.acme.io',
      provider: 'gitlab',
    })

    expect(result.details).toEqual({ ok: true })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('git.acme.io'),
        scopeKey: expect.objectContaining({
          requesterId: 'openwaggle:source-control',
          capability: 'actions.execute',
          resource: expect.any(String),
        }),
      }),
    )
    expect(backend.configure).toHaveBeenCalledWith(
      { kind: 'set-host-provider', host: 'git.acme.io', provider: 'gitlab' },
      expect.anything(),
    )
  })

  it('marks a host as neither GitHub nor GitLab so OpenWaggle stops asking', async () => {
    const { run, backend, authorize } = sourceControlToolHarness()

    const result = await run({
      action: 'configure',
      change: 'set-host-provider',
      host: 'code.internal',
      provider: 'unsupported',
    })

    expect(result.details).toEqual({ ok: true })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('neither GitHub nor GitLab') }),
    )
    expect(backend.configure).toHaveBeenCalledWith(
      { kind: 'set-host-provider', host: 'code.internal', provider: 'unsupported' },
      expect.anything(),
    )
  })

  it("declares a project host in the Session's working tree for the project root", async () => {
    const { run, backend } = sourceControlToolHarness()

    await run({
      action: 'configure',
      change: 'declare-project-host',
      host: 'git.acme.io',
      provider: 'gitlab',
    })

    expect(backend.configure).toHaveBeenCalledWith(
      {
        kind: 'declare-project-host',
        projectPath: PROJECT_ROOT,
        workingPath: WORKING_PATH,
        host: 'git.acme.io',
        provider: 'gitlab',
      },
      expect.anything(),
    )
  })

  it.each([
    {
      scope: 'user',
      expected: { kind: 'set-open-destination', scope: 'user', destination: 'website' },
    },
    {
      scope: 'project-local',
      expected: {
        kind: 'set-open-destination',
        scope: 'project-local',
        projectPath: PROJECT_ROOT,
        destination: 'website',
      },
    },
    {
      scope: 'project-shared',
      expected: {
        kind: 'set-open-destination',
        scope: 'project-shared',
        projectPath: PROJECT_ROOT,
        workingPath: WORKING_PATH,
        destination: 'website',
      },
    },
  ])('sets the $scope open destination scoped to the Session', async ({ scope, expected }) => {
    const { run, backend } = sourceControlToolHarness()

    await run({
      action: 'configure',
      change: 'set-open-destination',
      scope,
      destination: 'website',
    })

    expect(backend.configure).toHaveBeenCalledWith(expected, expect.anything())
  })

  it("remembers a Provider account for the Session's resolved repository", async () => {
    const { run, backend } = sourceControlToolHarness()

    await run({ action: 'configure', change: 'set-repository-account', login: 'dana-bot' })

    expect(backend.configure).toHaveBeenCalledWith(
      {
        kind: 'set-repository-account',
        repository: 'git.acme.io/platform/web/app',
        login: 'dana-bot',
      },
      expect.anything(),
    )
  })

  it('cannot choose an account when the remote has no resolved repository', async () => {
    const { run, backend, authorize } = sourceControlToolHarness({
      resolution: { kind: 'no-remote' },
    })

    const result = await run({ action: 'configure', change: 'set-repository-account', login: null })

    expect(result.details).toMatchObject({ ok: false, message: expect.stringContaining('status') })
    expect(authorize).not.toHaveBeenCalled()
    expect(backend.configure).not.toHaveBeenCalled()
  })

  it('returns the service failure message', async () => {
    const { run, backend } = sourceControlToolHarness()
    backend.configure.mockResolvedValueOnce({ ok: false, message: '"a b" is not a hostname.' })

    const result = await run({
      action: 'configure',
      change: 'set-host-provider',
      host: 'a b',
      provider: 'gitlab',
    })

    expect(result.details).toEqual({ ok: false, message: '"a b" is not a hostname.' })
  })

  it('redacts credentials in a failure message', async () => {
    const { run, backend } = sourceControlToolHarness()
    backend.configure.mockResolvedValueOnce({
      ok: false,
      message: 'write failed for https://glpat-SECRETSECRETSECRET1234@git.acme.io/a',
    })

    const result = await run({
      action: 'configure',
      change: 'set-host-provider',
      host: 'git.acme.io',
      provider: 'gitlab',
    })

    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(result.details).toEqual({ ok: false, message: 'write failed for https://git.acme.io/a' })
  })

  it('changes nothing when the user declines', async () => {
    const { run, backend } = sourceControlToolHarness({ approved: false })

    const result = await run({
      action: 'configure',
      change: 'set-host-provider',
      host: 'git.acme.io',
      provider: null,
    })

    expect(result).toMatchObject({ isError: true })
    expect(backend.configure).not.toHaveBeenCalled()
  })

  it('refuses to change anything without an authorization context', async () => {
    const { run, backend, authorize } = sourceControlToolHarness({ hasUI: false })

    const result = await run({
      action: 'configure',
      change: 'set-host-provider',
      host: 'git.acme.io',
      provider: 'gitlab',
    })

    expect(result).toMatchObject({ isError: true })
    expect(authorize).not.toHaveBeenCalled()
    expect(backend.configure).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'missing action', params: {} },
    { label: 'configure without a change', params: { action: 'configure' } },
    {
      label: 'set-host-provider without a provider',
      params: { action: 'configure', change: 'set-host-provider', host: 'git.acme.io' },
    },
    {
      label: 'an unsupported project declaration',
      params: {
        action: 'configure',
        change: 'declare-project-host',
        host: 'code.internal',
        provider: 'unsupported',
      },
    },
    {
      label: 'an unknown destination',
      params: {
        action: 'configure',
        change: 'set-open-destination',
        scope: 'user',
        destination: 'browser',
      },
    },
  ])('rejects $label before asking for authorization', async ({ params }) => {
    const { run, backend, authorize } = sourceControlToolHarness()

    const result = await run(params)

    expect(result).toMatchObject({ isError: true })
    expect(result.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Invalid source_control arguments'),
      }),
    ])
    expect(authorize).not.toHaveBeenCalled()
    expect(backend.configure).not.toHaveBeenCalled()
  })

  it('registers a flat provider-facing object schema', () => {
    const { parameters } = sourceControlToolHarness()
    const shape: unknown = JSON.parse(JSON.stringify(parameters))

    expect(shape).toMatchObject({ type: 'object', required: ['action'] })
    expect(shape).not.toHaveProperty('anyOf')
    expect(shape).toHaveProperty('properties.change')
    expect(shape).toHaveProperty('properties.login')
  })
})
