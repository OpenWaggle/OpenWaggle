import { describe, expect, it, vi } from 'vitest'
import type { GitPushDestination } from '../push-service'
import { buildOpenChangeRequestPayload } from '../stacked-action-change-request'

function deps(primaryRemoteUrl: string) {
  return {
    resolveCurrentRef: vi.fn(async () => 'feature/current'),
    resolveDefaultBaseRef: vi.fn(async () => 'main'),
    resolvePrimaryRemoteUrl: vi.fn(async () => primaryRemoteUrl),
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

    expect(payload).toMatchObject({ headOwner: 'contributor' })
  })
})
