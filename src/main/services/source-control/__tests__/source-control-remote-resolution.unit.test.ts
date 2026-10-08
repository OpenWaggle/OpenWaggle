import type { SourceControlHostChoice } from '@shared/types/source-control'
import { describe, expect, it, vi } from 'vitest'
import { resolveOffline as resolve, WORKING_PATH } from './source-control-test-deps'

describe('resolving the source-control repository behind a working tree', () => {
  it('resolves a public GitHub remote', async () => {
    await expect(resolve()).resolves.toEqual({
      kind: 'resolved',
      remote: { name: 'origin', url: 'git@github.com:acme/app.git' },
      repository: { provider: 'github', host: 'github.com', owner: 'acme', repository: 'app' },
      hostState: { host: 'github.com', provider: 'github', source: 'public-host' },
      attention: null,
    })
  })

  it('reports a working tree without a remote', async () => {
    await expect(resolve({ readPrimaryRemote: async () => null })).resolves.toEqual({
      kind: 'no-remote',
    })
  })

  it('resolves an SSH host alias to its real hostname first', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@github-work:acme/app.git' }),
      resolveSshHostName: async (alias) => (alias === 'github-work' ? 'github.com' : alias),
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      repository: { provider: 'github', host: 'github.com', owner: 'acme', repository: 'app' },
    })
  })

  it('maps a glab SSH host to its GitLab instance', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({
        name: 'origin',
        url: 'ssh://git@ssh.git.acme.io:2222/platform/app.git',
      }),
      readCliHosts: async () => ({
        github: [],
        gitlab: [{ host: 'git.acme.io', sshHost: 'ssh.git.acme.io', accounts: [] }],
      }),
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      repository: { provider: 'gitlab', host: 'git.acme.io', owner: 'platform', repository: 'app' },
      hostState: { host: 'git.acme.io', provider: 'gitlab', source: 'cli-sign-in' },
    })
  })

  it('keeps a non-default HTTPS port in the host', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({
        name: 'origin',
        url: 'https://gitlab.acme.io:8443/group/sub/app.git',
      }),
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      repository: {
        provider: 'gitlab',
        host: 'gitlab.acme.io:8443',
        owner: 'group/sub',
        repository: 'app',
      },
    })
  })

  it('leaves an unknown host undecided offline and asks only after probing', async () => {
    const remote = { name: 'origin', url: 'git@code.acme.io:acme/app.git' }
    const offline = await resolve({ readPrimaryRemote: async () => remote })
    expect(offline).toEqual({
      kind: 'undecided',
      remote,
      hostState: { host: 'code.acme.io', provider: null, source: null },
      attention: null,
    })

    const probed = await resolve({ readPrimaryRemote: async () => remote }, true)
    expect(probed).toMatchObject({
      kind: 'undecided',
      attention: { kind: 'choose-provider', host: 'code.acme.io' },
    })
  })

  it('learns a provider from the remote refs and remembers it for the host', async () => {
    const rememberDetectedHost = vi.fn(async () => undefined)
    const result = await resolve(
      {
        readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
        probeRemoteRefs: async (path, remoteName) =>
          path === WORKING_PATH && remoteName === 'origin' ? 'github' : null,
        rememberDetectedHost,
      },
      true,
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      hostState: { host: 'code.acme.io', provider: 'github', source: 'remote-refs' },
    })
    expect(rememberDetectedHost).toHaveBeenCalledWith('code.acme.io', 'github')
  })

  it('does not treat a local path remote as a source-control host', async () => {
    await expect(
      resolve({ readPrimaryRemote: async () => ({ name: 'origin', url: '/srv/git/app.git' }) }),
    ).resolves.toMatchObject({ kind: 'unrecognised-remote' })
  })

  it('keeps a recognised host as written, so SSH-over-443 configs do not move it', async () => {
    const resolveSshHostName = vi.fn(async () => 'ssh.github.com')
    const readCredentialHelpers = vi.fn(async () => ({}))

    const result = await resolve({ resolveSshHostName, readCredentialHelpers })

    expect(result).toMatchObject({ repository: { host: 'github.com' } })
    expect(resolveSshHostName).not.toHaveBeenCalled()
    expect(readCredentialHelpers).not.toHaveBeenCalled()
  })

  it('maps the providers’ SSH-over-443 hostnames back to their web hosts', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@work-gitlab:acme/app.git' }),
      resolveSshHostName: async () => 'altssh.gitlab.com',
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      repository: { provider: 'gitlab', host: 'gitlab.com' },
    })
  })

  it('reads git credential helpers only when stronger signals did not decide', async () => {
    const readCredentialHelpers = vi.fn(async () => ({ 'gitlab.acme.io': 'github' as const }))

    const result = await resolve({
      readPrimaryRemote: async () => ({
        name: 'origin',
        url: 'https://gitlab.acme.io/acme/app.git',
      }),
      readCredentialHelpers,
    })

    expect(readCredentialHelpers).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      hostState: { provider: 'github', source: 'git-credential-helper' },
    })
  })

  it('stops at a host the user said is neither GitHub nor GitLab', async () => {
    const probeRemoteRefs = vi.fn(async () => 'github' as const)
    const result = await resolve(
      {
        readPrimaryRemote: async () => ({ name: 'origin', url: 'git@code.acme.io:acme/app.git' }),
        readPreferences: async () => ({
          userChoices: { 'code.acme.io': 'unsupported' },
          detectedHosts: {},
          projectDeclarations: {},
        }),
        probeRemoteRefs,
      },
      true,
    )

    expect(result).toMatchObject({ kind: 'unrecognised-remote' })
    expect(probeRemoteRefs).not.toHaveBeenCalled()
  })

  it.each([
    'git@bitbucket.org:acme/app.git',
    'https://dev.azure.com/acme/project/_git/app',
    'https://git.acme.io/scm/proj/app.git',
    'https://codeberg.org/acme/app.git',
  ])('does not mistake another forge for GitHub or GitLab: %s', async (url) => {
    const result = await resolve(
      {
        readPrimaryRemote: async () => ({ name: 'origin', url }),
        probeRemoteRefs: async () => 'github',
      },
      true,
    )

    expect(result).toMatchObject({ kind: 'unrecognised-remote' })
  })

  it.each<[string, string, Record<string, SourceControlHostChoice>]>([
    ['a GitHub repository named scm', 'git@github.com:scm/tool.git', {}],
    [
      'a GitLab host the user chose',
      'git@git.acme.io:scm/proj/app.git',
      { 'git.acme.io': 'gitlab' },
    ],
  ])('keeps %s', async (_case, url, userChoices) => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url }),
      readPreferences: async () => ({ userChoices, detectedHosts: {}, projectDeclarations: {} }),
    })

    expect(result).toMatchObject({ kind: 'resolved' })
  })

  it('recognises GitHub Enterprise Cloud data-residency hosts', async () => {
    const result = await resolve({
      readPrimaryRemote: async () => ({ name: 'origin', url: 'git@acme.ghe.com:acme/app.git' }),
    })

    expect(result).toMatchObject({
      kind: 'resolved',
      hostState: { host: 'acme.ghe.com', provider: 'github', source: 'public-host' },
    })
  })
})
