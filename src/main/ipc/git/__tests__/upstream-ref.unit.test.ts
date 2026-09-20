import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGitMock } = vi.hoisted(() => ({ runGitMock: vi.fn() }))

vi.mock('../shared', () => ({ runGit: runGitMock }))

const { readPushRef, readUpstreamRef } = await import('../upstream-ref')

function result(
  code: number,
  stdout = '',
  stderr = '',
  metadata: { readonly executionFailed?: boolean } = {},
) {
  return { code, stdout, stderr, ...metadata }
}

function routeGit(routes: Readonly<Record<string, ReturnType<typeof result>>>) {
  runGitMock.mockImplementation(async (...call: readonly unknown[]) => {
    const args = call[1]
    if (!Array.isArray(args)) {
      throw new Error(`Unexpected runGit call: ${JSON.stringify(call)}`)
    }
    const command = args.join(' ')
    const routed = routes[command]
    if (routed) return routed
    if (command.startsWith('config --get-all ')) return result(1)
    throw new Error(`Unexpected Git command: ${command}`)
  })
}

describe('Git push destination resolution', () => {
  beforeEach(() => {
    runGitMock.mockReset()
  })

  it('preserves slash-containing upstream remote names', async () => {
    routeGit({
      'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/feature':
        result(0, 'team/fork\0refs/heads/main\n'),
    })

    await expect(readUpstreamRef('/repo', 'feature')).resolves.toEqual({
      ok: true,
      upstream: { remote: 'team/fork', branch: 'main' },
    })
  })

  it('uses the current branch for push.default=current on a branch pushRemote', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, 'fork\n'),
      'config --get-all push.default': result(0, 'current\n'),
    })

    await expect(readPushRef('/repo', 'feature')).resolves.toEqual({
      ok: true,
      upstream: { remote: 'fork', branch: 'feature' },
      usedFallbackRemote: false,
    })
  })

  it('uses the fetch upstream only for push.default=upstream on the same push remote', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, 'origin\n'),
      'config --get-all push.default': result(0, 'upstream\n'),
      'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/feature':
        result(0, 'origin\0refs/heads/main\n'),
    })

    await expect(readPushRef('/repo', 'feature')).resolves.toMatchObject({
      ok: true,
      upstream: { remote: 'origin', branch: 'main' },
    })
  })

  it('rejects push.default=upstream when pushRemote and fetch upstream differ', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, 'fork\n'),
      'config --get-all push.default': result(0, 'upstream\n'),
      'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/feature':
        result(0, 'origin\0refs/heads/main\n'),
    })

    await expect(readPushRef('/repo', 'feature')).resolves.toEqual({
      ok: false,
      message: 'The configured upstream push destination does not match the push remote.',
      recoverable: false,
    })
  })

  it('resolves a first push through the caller fallback while applying simple semantics', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0),
      'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/feature':
        result(0),
    })

    await expect(readPushRef('/repo', 'feature', 'upstream')).resolves.toEqual({
      ok: true,
      upstream: { remote: 'upstream', branch: 'feature' },
      usedFallbackRemote: true,
    })
  })

  it.each(['nothing', 'matching'] as const)(
    'refuses push.default=%s instead of widening a single-branch action',
    async (pushDefault) => {
      routeGit({
        'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0),
        'config --get-all push.default': result(0, `${pushDefault}\n`),
      })

      await expect(readPushRef('/repo', 'feature', 'origin')).resolves.toEqual({
        ok: false,
        message: `OpenWaggle cannot safely run push.default=${pushDefault} as a single-branch action.`,
        recoverable: false,
      })
    },
  )

  it('honors one exact remote push refspec for the current branch', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, 'fork\n'),
      'config --get-all remote.fork.push': result(
        0,
        'refs/heads/feature:refs/heads/review/feature\n',
      ),
    })

    await expect(readPushRef('/repo', 'feature')).resolves.toMatchObject({
      ok: true,
      upstream: { remote: 'fork', branch: 'review/feature' },
    })
  })

  it('rejects multiple remote push refspecs and Git boolean mirror aliases', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, 'fork\n'),
      'config --get-all remote.fork.push': result(
        0,
        'HEAD:refs/heads/feature\nHEAD:refs/heads/backup\n',
      ),
    })
    await expect(readPushRef('/repo', 'feature')).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('multiple refs'),
    })

    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, 'fork\n'),
      'config --get-all remote.fork.mirror': result(0, 'yes\n'),
    })
    await expect(readPushRef('/repo', 'feature')).resolves.toEqual({
      ok: false,
      message: 'OpenWaggle cannot safely run a mirror push.',
      recoverable: false,
    })
  })

  it('keeps execution failures distinct from an ordinary missing config', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, 'origin\n'),
      'config --get-all remote.origin.mirror': result(1, '', 'spawn git EAGAIN', {
        executionFailed: true,
      }),
    })

    await expect(readPushRef('/repo', 'feature')).resolves.toEqual({
      ok: false,
      message: 'Could not read Git push configuration: spawn git EAGAIN',
    })
  })

  it('rejects the local repository even when Git exposes it through the push atom', async () => {
    routeGit({
      'for-each-ref --format=%(push:remotename) refs/heads/feature': result(0, '.\n'),
    })

    await expect(readPushRef('/repo', 'feature')).resolves.toEqual({
      ok: false,
      message: 'OpenWaggle cannot safely run a push configured for the local repository.',
      recoverable: false,
    })
  })
})
