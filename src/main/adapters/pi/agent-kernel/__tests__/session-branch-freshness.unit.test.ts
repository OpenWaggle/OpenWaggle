import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../../ports/agent-kernel-service'

const {
  fetchRemoteBranchMock,
  isLocalBranchMock,
  localBranchIsBehindRemoteMock,
  pullCurrentBranchFastForwardMock,
  resolveTrackedBranchMock,
  runGitMock,
} = vi.hoisted(() => ({
  resolveTrackedBranchMock: vi.fn(
    async (_projectPath: string): Promise<{ branch: string; upstream: string } | null> => ({
      branch: 'main',
      upstream: 'origin/main',
    }),
  ),
  fetchRemoteBranchMock: vi.fn(async (_projectPath: string, _branch: string) => true),
  isLocalBranchMock: vi.fn(async (_projectPath: string, _branch: string) => true),
  localBranchIsBehindRemoteMock: vi.fn(async (_projectPath: string, _branch: string) => false),
  pullCurrentBranchFastForwardMock: vi.fn(
    async (_path: string, _options?: { readonly signal?: AbortSignal }) => ({
      ok: true,
      message: 'Pulled latest changes.',
    }),
  ),
  runGitMock: vi.fn(async (_cwd: string, _args: readonly string[]) => ({
    code: 0,
    stdout: 'main\n',
    stderr: '',
  })),
}))

vi.mock('../../../git/run-git', () => ({ runGit: runGitMock }))
vi.mock('../../../git/remote-sync', () => ({
  fetchRemoteBranch: fetchRemoteBranchMock,
  isLocalBranch: isLocalBranchMock,
  localBranchIsBehindRemote: localBranchIsBehindRemoteMock,
  pullCurrentBranchFastForward: pullCurrentBranchFastForwardMock,
  resolveTrackedBranch: resolveTrackedBranchMock,
}))

const { refreshFirstRunBranch, resolveFreshWorktreeBaseRef } = await import(
  '../session-branch-freshness'
)

describe('resolveFreshWorktreeBaseRef', () => {
  beforeEach(() => {
    fetchRemoteBranchMock.mockReset().mockResolvedValue(true)
    isLocalBranchMock.mockReset().mockResolvedValue(true)
    localBranchIsBehindRemoteMock.mockReset().mockResolvedValue(false)
    runGitMock.mockReset().mockResolvedValue({ code: 0, stdout: 'main\n', stderr: '' })
  })

  it('fetches the chosen branch and births from origin when the local branch is behind its remote', async () => {
    localBranchIsBehindRemoteMock.mockResolvedValue(true)
    await expect(resolveFreshWorktreeBaseRef({ worktreeBaseRef: 'main' }, '/repo')).resolves.toBe(
      'origin/main',
    )
    expect(fetchRemoteBranchMock).toHaveBeenCalledWith('/repo', 'main', expect.anything())
  })

  it('announces the fetch before waiting on the network', async () => {
    const onFetch = vi.fn()
    fetchRemoteBranchMock.mockImplementation(async () => {
      expect(onFetch).toHaveBeenCalledWith('main')
      return true
    })
    await resolveFreshWorktreeBaseRef({ worktreeBaseRef: 'main' }, '/repo', { onFetch })
    expect(fetchRemoteBranchMock).toHaveBeenCalledOnce()
  })

  it('births from origin when start-from-origin is set', async () => {
    await expect(
      resolveFreshWorktreeBaseRef(
        { worktreeBaseRef: 'main', worktreeStartFromOrigin: true },
        '/repo',
      ),
    ).resolves.toBe('origin/main')
    expect(fetchRemoteBranchMock).toHaveBeenCalledWith('/repo', 'main', expect.anything())
  })

  it('keeps the local base ref when the local branch is not behind its remote', async () => {
    await expect(resolveFreshWorktreeBaseRef({ worktreeBaseRef: 'main' }, '/repo')).resolves.toBe(
      'main',
    )
  })

  it('falls back to the current branch when no base ref is chosen', async () => {
    await expect(resolveFreshWorktreeBaseRef({ worktreeBaseRef: null }, '/repo')).resolves.toBe(
      'main',
    )
    expect(fetchRemoteBranchMock).toHaveBeenCalledWith('/repo', 'main', expect.anything())
  })

  it('fetches slash-named local branches too and births from origin when behind', async () => {
    localBranchIsBehindRemoteMock.mockResolvedValue(true)
    await expect(
      resolveFreshWorktreeBaseRef({ worktreeBaseRef: 'feature/foo' }, '/repo'),
    ).resolves.toBe('origin/feature/foo')
    expect(fetchRemoteBranchMock).toHaveBeenCalledWith('/repo', 'feature/foo', expect.anything())
  })

  it('does not fetch a base ref that already names a remote', async () => {
    isLocalBranchMock.mockResolvedValue(false)
    await expect(
      resolveFreshWorktreeBaseRef({ worktreeBaseRef: 'origin/feature' }, '/repo'),
    ).resolves.toBe('origin/feature')
    expect(fetchRemoteBranchMock).not.toHaveBeenCalled()
  })

  it('returns null when no branch is resolvable', async () => {
    runGitMock.mockResolvedValue({ code: 1, stdout: '', stderr: 'not a branch' })
    await expect(
      resolveFreshWorktreeBaseRef({ worktreeBaseRef: null }, '/repo'),
    ).resolves.toBeNull()
    expect(fetchRemoteBranchMock).not.toHaveBeenCalled()
  })
})

describe('refreshFirstRunBranch', () => {
  function kernelInput(extra: {
    readonly environmentMode?: 'local' | 'worktree'
    readonly messages?: Message[]
  }) {
    return fromPartial<AgentKernelRunInput>({
      session: {
        id: SessionId('session-1'),
        projectPath: '/repo',
        messages: extra.messages ?? [],
        ...(extra.environmentMode ? { environmentMode: extra.environmentMode } : {}),
      },
      runId: 'run-1',
      payload: { text: 'Do the work', thinkingLevel: 'medium', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })
  }

  beforeEach(() => {
    pullCurrentBranchFastForwardMock.mockReset().mockResolvedValue({
      ok: true,
      message: 'Pulled latest changes.',
    })
    resolveTrackedBranchMock
      .mockReset()
      .mockResolvedValue({ branch: 'main', upstream: 'origin/main' })
  })

  it('reports the pull as a local launch step before it reaches the network', async () => {
    const onProgress = vi.fn()
    pullCurrentBranchFastForwardMock.mockImplementation(async () => {
      expect(onProgress).toHaveBeenCalledWith({
        stage: 'syncing-branch',
        environment: 'local',
        parallel: true,
        label: 'Pulling latest changes for main',
        details: ['Pulling origin/main into main'],
      })
      return { ok: true, message: 'Pulled latest changes.' }
    })
    await Effect.runPromise(refreshFirstRunBranch(kernelInput({}), '/repo', onProgress))
    expect(pullCurrentBranchFastForwardMock).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenLastCalledWith({
      stage: 'syncing-branch',
      environment: 'local',
      completesStep: true,
      details: [],
    })
  })

  it('stops the pull when the run is cancelled, and does not report it finished', async () => {
    const controller = new AbortController()
    const onProgress = vi.fn()
    pullCurrentBranchFastForwardMock.mockImplementation(
      async (_path: string, options?: { readonly signal?: AbortSignal }) => {
        controller.abort()
        expect(options?.signal?.aborted).toBe(true)
        return { ok: false, message: 'aborted' }
      },
    )
    const input = fromPartial<AgentKernelRunInput>({
      ...kernelInput({}),
      signal: controller.signal,
    })
    await Effect.runPromise(refreshFirstRunBranch(input, '/repo', onProgress))
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ completesStep: true }))
  })

  it('skips the pull, and reports nothing, when the branch tracks no upstream', async () => {
    resolveTrackedBranchMock.mockResolvedValue(null)
    const onProgress = vi.fn()
    await Effect.runPromise(refreshFirstRunBranch(kernelInput({}), '/repo', onProgress))
    expect(pullCurrentBranchFastForwardMock).not.toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('pulls the checked-out branch before the first run of a local-mode conversation', async () => {
    const input = kernelInput({})
    await Effect.runPromise(refreshFirstRunBranch(input, '/repo'))
    expect(pullCurrentBranchFastForwardMock).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('skips worktree-mode sessions', async () => {
    await Effect.runPromise(
      refreshFirstRunBranch(kernelInput({ environmentMode: 'worktree' }), '/repo'),
    )
    expect(pullCurrentBranchFastForwardMock).not.toHaveBeenCalled()
  })

  it('skips runs after the first', async () => {
    await Effect.runPromise(
      refreshFirstRunBranch(
        kernelInput({ messages: [fromPartial<Message>({ id: MessageId('m1') })] }),
        '/repo',
      ),
    )
    expect(pullCurrentBranchFastForwardMock).not.toHaveBeenCalled()
  })

  it('never blocks the turn on a failed pull', async () => {
    pullCurrentBranchFastForwardMock.mockResolvedValue({ ok: false, message: 'diverged' })
    await expect(
      Effect.runPromise(refreshFirstRunBranch(kernelInput({}), '/repo')),
    ).resolves.toBeUndefined()
  })
})
