import { describe, expect, it, vi } from 'vitest'
import {
  offlineResolutionDeps,
  resolveRemoteRepositoryOffline,
} from '../../../services/source-control/__tests__/source-control-test-deps'
import { resolveRemoteUrlRepository } from '../../../services/source-control/working-tree-source-control'
import type { GitPushDestination } from '../push-service'
import { buildOpenChangeRequestPayload } from '../stacked-action-change-request'

function deps(primaryRemoteUrl: string) {
  return {
    resolveCurrentRef: vi.fn(async () => 'feature/current'),
    resolveDefaultBaseRef: vi.fn(async () => 'main'),
    resolvePrimaryRemoteUrl: vi.fn(async () => primaryRemoteUrl),
    resolveRemoteRepository: resolveRemoteRepositoryOffline,
  }
}

function destination(remoteUrl: string | null, multiplePushUrls = false): GitPushDestination {
  return {
    remote: 'fork',
    branch: 'feature/current',
    remoteUrl,
    multiplePushUrls,
  }
}

describe('change-request pushed-head compatibility', () => {
  it.each([
    ['another host', 'git@github.enterprise.test:contributor/project.git', false],
    ['another same-owner repository', 'git@github.com:upstream/other-project.git', false],
    ['another enterprise port', 'ssh://git@github.com:9443/contributor/project.git', false],
    ['multiple push URLs', null, true],
  ])('fails closed for a pushed head in %s', async (_case, remoteUrl, multiplePushUrls) => {
    const payload = await buildOpenChangeRequestPayload(
      deps('https://github.com/upstream/project.git'),
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination(remoteUrl, multiplePushUrls),
    )

    expect(payload).toBeNull()
  })

  it('fails closed when a provider-looking base remote has no repository identity', async () => {
    const payload = await buildOpenChangeRequestPayload(
      deps('https://github.com'),
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination('git@github.com:contributor/project.git'),
    )

    expect(payload).toBeNull()
  })

  it('keeps same-repository GitLab MR creation compatible', async () => {
    const payload = await buildOpenChangeRequestPayload(
      deps('git@gitlab.com:team/project.git'),
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination('git@gitlab.com:team/project.git'),
    )

    expect(payload).toMatchObject({ headRef: 'feature/current', baseRef: 'main' })
    expect(payload).toMatchObject({
      targetRepository: {
        provider: 'gitlab',
        host: 'gitlab.com',
        owner: 'team',
        repository: 'project',
      },
    })
    expect(payload).not.toHaveProperty('headOwner')
    expect(payload).not.toHaveProperty('headRepository')
  })

  it('carries a GitLab fork project into merge-request creation', async () => {
    const payload = await buildOpenChangeRequestPayload(
      deps('git@gitlab.com:upstream/team/project.git'),
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination('git@gitlab.com:contributors/alex/project.git'),
    )

    expect(payload).toMatchObject({
      headRef: 'feature/current',
      baseRef: 'main',
      headRepository: 'contributors/alex/project',
      targetRepository: {
        provider: 'gitlab',
        host: 'gitlab.com',
        owner: 'upstream/team',
        repository: 'project',
      },
    })
    expect(payload).not.toHaveProperty('headOwner')
  })

  it('supports a renamed GitLab fork project', async () => {
    const payload = await buildOpenChangeRequestPayload(
      deps('git@gitlab.com:upstream/team/project.git'),
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination('git@gitlab.com:contributors/alex/project-fork.git'),
    )

    expect(payload).toMatchObject({ headRepository: 'contributors/alex/project-fork' })
  })

  it('supports a renamed GitHub fork owned by a contributor', async () => {
    const payload = await buildOpenChangeRequestPayload(
      deps('git@github.com:upstream/project.git'),
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination('git@github.com:contributor/project-fork.git'),
    )

    expect(payload).toMatchObject({
      headOwner: 'contributor',
      headRepository: 'contributor/project-fork',
      targetRepository: {
        provider: 'github',
        host: 'github.com',
        owner: 'upstream',
        repository: 'project',
      },
    })
  })

  it('creates on a host recognised from a gh sign-in, not from its name', async () => {
    const resolveRemoteRepository = (projectPath: string, remoteUrl: string) =>
      resolveRemoteUrlRepository(
        projectPath,
        remoteUrl,
        offlineResolutionDeps({
          readCliHosts: async () => ({
            github: [{ host: 'code.acme.io', accounts: [{ login: 'jdoe', active: true }] }],
            gitlab: [],
          }),
        }),
        null,
      )
    const payload = await buildOpenChangeRequestPayload(
      { ...deps('git@code.acme.io:upstream/project.git'), resolveRemoteRepository },
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination('git@code.acme.io:contributor/project.git'),
    )

    expect(payload).toMatchObject({
      headOwner: 'contributor',
      targetRepository: { provider: 'github', host: 'code.acme.io', owner: 'upstream' },
    })
  })

  it('creates through an SSH host alias against the real host', async () => {
    const resolveRemoteRepository = (projectPath: string, remoteUrl: string) =>
      resolveRemoteUrlRepository(
        projectPath,
        remoteUrl,
        offlineResolutionDeps({
          resolveSshHostName: async (alias) => (alias === 'github-work' ? 'github.com' : alias),
        }),
        null,
      )
    const payload = await buildOpenChangeRequestPayload(
      { ...deps('git@github-work:upstream/project.git'), resolveRemoteRepository },
      '/repo',
      { action: 'create_pr' },
      { status: 'unchanged', name: null },
      destination('git@github-work:upstream/project.git'),
    )

    expect(payload).toMatchObject({
      targetRepository: { provider: 'github', host: 'github.com', owner: 'upstream' },
    })
  })
})
