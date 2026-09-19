import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrimaryRemoteResolution } from '../primary-remote'

const { isGitRepositoryMock, resolvePrimaryRemoteResultMock, runGitMock } = vi.hoisted(() => ({
  isGitRepositoryMock: vi.fn(async () => true),
  resolvePrimaryRemoteResultMock: vi.fn<() => Promise<PrimaryRemoteResolution>>(async () => ({
    ok: true,
    remote: { name: 'origin', url: 'https://example.com/o/r' },
  })),
  runGitMock: vi.fn(),
}))

vi.mock('../shared', () => ({
  isGitRepository: isGitRepositoryMock,
  runGit: runGitMock,
}))

vi.mock('../primary-remote', () => ({
  resolvePrimaryRemoteResult: resolvePrimaryRemoteResultMock,
}))

const { pushCurrentBranch } = await import('../push-service')

function result(
  code: number,
  stdout = '',
  stderr = '',
  metadata: { readonly executionFailed?: boolean } = {},
) {
  return { code, stdout, stderr, ...metadata }
}

describe('pushCurrentBranch safety reads', () => {
  beforeEach(() => {
    isGitRepositoryMock.mockReset().mockResolvedValue(true)
    resolvePrimaryRemoteResultMock.mockReset().mockResolvedValue({
      ok: true,
      remote: { name: 'origin', url: 'https://example.com/o/r' },
    })
    runGitMock.mockReset()
  })

  it('aborts rather than treating a failed upstream probe as a first push', async () => {
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      const command = args.join(' ')
      if (command === 'symbolic-ref --quiet --short HEAD') return result(0, 'feature\n')
      if (command.startsWith('for-each-ref')) {
        return result(1, '', 'spawn git EAGAIN', { executionFailed: true })
      }
      throw new Error(`Unexpected Git command: ${command}`)
    })

    await expect(pushCurrentBranch('/repo')).resolves.toEqual({
      ok: false,
      code: 'push-failed',
      message: 'Could not read the Git push destination: spawn git EAGAIN',
    })
    expect(runGitMock.mock.calls.some(([, args]) => args.includes('push'))).toBe(false)
  })

  it('uses the first-push flow only after a successful empty upstream read', async () => {
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      const command = args.join(' ')
      if (command === 'symbolic-ref --quiet --short HEAD') return result(0, 'feature\n')
      if (command.startsWith('for-each-ref')) return result(0)
      if (command.startsWith('config --get-all ')) return result(1)
      if (command === 'remote get-url --push --all origin') {
        return result(0, 'https://example.com/o/r\n')
      }
      if (args[0] === 'push') return result(0)
      throw new Error(`Unexpected Git command: ${command}`)
    })

    await expect(pushCurrentBranch('/repo')).resolves.toMatchObject({
      ok: true,
      destination: { remote: 'origin', branch: 'feature' },
    })
    expect(runGitMock).toHaveBeenCalledWith(
      '/repo',
      ['push', '-u', 'origin', 'HEAD:refs/heads/feature'],
      expect.any(Object),
    )
  })

  it('preserves slash-containing remote names when pushing to an upstream', async () => {
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      const command = args.join(' ')
      if (command === 'symbolic-ref --quiet --short HEAD') return result(0, 'feature\n')
      if (command.startsWith('for-each-ref --format=%(push:remotename)')) {
        return result(0, 'foo/bar\n')
      }
      if (command.startsWith('for-each-ref --format=%(upstream:remotename)')) {
        return result(0, 'foo/bar\0refs/heads/main\n')
      }
      if (command === 'config --get-all push.default') return result(0, 'upstream\n')
      if (command.startsWith('config --get-all ')) return result(1)
      if (command === 'remote get-url --push --all foo/bar') {
        return result(0, 'https://example.com/fork/r\n')
      }
      if (args[0] === 'push') return result(0)
      throw new Error(`Unexpected Git command: ${command}`)
    })

    await expect(pushCurrentBranch('/repo')).resolves.toMatchObject({
      ok: true,
      destination: { remote: 'foo/bar', branch: 'main' },
    })
    expect(runGitMock).toHaveBeenCalledWith(
      '/repo',
      ['push', 'foo/bar', 'HEAD:refs/heads/main'],
      expect.any(Object),
    )
  })

  it('does not fall back to origin when configured remotes cannot be read', async () => {
    resolvePrimaryRemoteResultMock.mockResolvedValue({
      ok: false,
      message: 'Could not read Git remotes: spawn git EAGAIN',
    })
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      const command = args.join(' ')
      if (command === 'symbolic-ref --quiet --short HEAD') return result(0, 'feature\n')
      if (command.startsWith('for-each-ref')) return result(0)
      if (command.startsWith('config --get-all ')) return result(1)
      throw new Error(`Unexpected Git command: ${command}`)
    })

    await expect(pushCurrentBranch('/repo')).resolves.toEqual({
      ok: false,
      code: 'push-failed',
      message: 'Could not read Git remotes: spawn git EAGAIN',
    })
    expect(runGitMock.mock.calls.some(([, args]) => args.includes('push'))).toBe(false)
  })

  it('aborts a pinned stacked push when its effective URL changes', async () => {
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      const command = args.join(' ')
      if (command === 'symbolic-ref --quiet --short HEAD') return result(0, 'feature\n')
      if (command.startsWith('for-each-ref --format=%(upstream:remotename)')) {
        return result(0, 'origin\0refs/heads/feature\n')
      }
      if (command === 'remote get-url --push --all origin') {
        return result(0, 'ssh://new.example/repo\n')
      }
      throw new Error(`Unexpected Git command: ${command}`)
    })

    await expect(
      pushCurrentBranch('/repo', undefined, {
        sourceBranch: 'feature',
        remote: 'origin',
        branch: 'feature',
        pushUrls: ['ssh://old.example/repo'],
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'push-failed',
      message: 'The Git push URL changed after the destination was confirmed.',
    })
    expect(runGitMock.mock.calls.some(([, args]) => args.includes('push'))).toBe(false)
  })

  it('pins the verified URL behind a one-shot alias inside the push process', async () => {
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      const command = args.join(' ')
      if (command === 'symbolic-ref --quiet --short HEAD') return result(0, 'feature\n')
      if (command.startsWith('for-each-ref --format=%(upstream:remotename)')) {
        return result(0, 'origin\0refs/heads/feature\n')
      }
      if (command === 'remote get-url --push --all origin') {
        return result(0, 'ssh://approved.example/repo\n')
      }
      if (args.includes('push')) return result(0)
      throw new Error(`Unexpected Git command: ${command}`)
    })

    await expect(
      pushCurrentBranch('/repo', undefined, {
        sourceBranch: 'feature',
        remote: 'origin',
        branch: 'feature',
        pushUrls: ['ssh://approved.example/repo'],
      }),
    ).resolves.toMatchObject({ ok: true })
    const pushCall = runGitMock.mock.calls.find(([, args]) => args.includes('push'))
    const aliasArgument = pushCall?.[1]?.[3]
    const alias = aliasArgument?.slice('remote.origin.pushurl='.length)
    expect(alias).toMatch(/^openwaggle-push-[0-9a-f-]+:$/u)
    expect(pushCall?.[1]).toEqual([
      '-c',
      'remote.origin.pushurl=',
      '-c',
      `remote.origin.pushurl=${alias}`,
      'push',
      'origin',
      'HEAD:refs/heads/feature',
    ])
    const pushEnvironment = pushCall?.[2]?.env
    expect(pushEnvironment).toMatchObject({
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      GIT_CONFIG_PARAMETERS: '',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'url.ssh://approved.example/repo.insteadOf',
      GIT_CONFIG_VALUE_0: alias,
    })
    expect(runGitMock).toHaveBeenCalledWith(
      '/repo',
      pushCall?.[1],
      expect.objectContaining({ env: pushEnvironment }),
    )
  })

  it('fails closed when an approved remote name cannot be represented by a command-scope config key', async () => {
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      const command = args.join(' ')
      if (command === 'symbolic-ref --quiet --short HEAD') return result(0, 'feature\n')
      if (command.startsWith('for-each-ref --format=%(upstream:remotename)')) {
        return result(0, 'foo=bar\0refs/heads/feature\n')
      }
      if (command === 'remote get-url --push --all foo=bar') {
        return result(0, 'ssh://approved.example/repo\n')
      }
      throw new Error(`Unexpected Git command: ${command}`)
    })

    await expect(
      pushCurrentBranch('/repo', undefined, {
        sourceBranch: 'feature',
        remote: 'foo=bar',
        branch: 'feature',
        pushUrls: ['ssh://approved.example/repo'],
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'push-failed',
      message: 'The approved Git remote name cannot be pinned safely.',
    })
    expect(runGitMock.mock.calls.some(([, args]) => args.includes('push'))).toBe(false)
  })
})
