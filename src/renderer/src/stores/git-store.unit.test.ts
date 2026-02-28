import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── IPC Mock ───────────────────────────────────────────────
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    commitGit: vi.fn(),
    checkoutGitBranch: vi.fn(),
    createGitBranch: vi.fn(),
    renameGitBranch: vi.fn(),
    deleteGitBranch: vi.fn(),
    setGitBranchUpstream: vi.fn(),
  },
}))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import { useGitStore } from './git-store'

function resetStore(): void {
  useGitStore.setState({
    status: null,
    branches: null,
    isLoading: false,
    isCommitting: false,
    isBranchActionRunning: false,
    statusError: null,
    branchesError: null,
  })
}

describe('useGitStore unit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  // ── refreshStatus ──

  describe('refreshStatus', () => {
    it('clears status and error when projectPath is null', async () => {
      useGitStore.setState({
        status: {
          branch: 'old',
          additions: 0,
          deletions: 0,
          filesChanged: 0,
          changedFiles: [],
          clean: true,
          ahead: 0,
          behind: 0,
        },
        statusError: 'old error',
        isLoading: true,
      })

      await useGitStore.getState().refreshStatus(null)

      expect(useGitStore.getState().status).toBeNull()
      expect(useGitStore.getState().statusError).toBeNull()
      expect(useGitStore.getState().isLoading).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
    })

    it('sets isLoading true then false on successful fetch', async () => {
      const states: boolean[] = []
      const unsub = useGitStore.subscribe((s) => states.push(s.isLoading))

      apiMock.getGitStatus.mockResolvedValue({
        branch: 'main',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
      })

      await useGitStore.getState().refreshStatus('/tmp/repo')

      unsub()
      expect(states).toContain(true)
      expect(useGitStore.getState().isLoading).toBe(false)
    })

    it('sets statusError when getGitStatus throws an Error', async () => {
      apiMock.getGitStatus.mockRejectedValue(new Error('git not found'))

      await useGitStore.getState().refreshStatus('/tmp/repo')

      expect(useGitStore.getState().status).toBeNull()
      expect(useGitStore.getState().statusError).toBe('git not found')
      expect(useGitStore.getState().isLoading).toBe(false)
    })

    it('sets fallback statusError when thrown value is not an Error', async () => {
      apiMock.getGitStatus.mockRejectedValue('string error')

      await useGitStore.getState().refreshStatus('/tmp/repo')

      expect(useGitStore.getState().statusError).toBe('Failed to load Git status.')
      expect(useGitStore.getState().isLoading).toBe(false)
    })

    it('clears statusError on subsequent success', async () => {
      useGitStore.setState({ statusError: 'previous error' })

      apiMock.getGitStatus.mockResolvedValue({
        branch: 'dev',
        additions: 2,
        deletions: 1,
        filesChanged: 3,
        changedFiles: [],
        clean: false,
        ahead: 1,
        behind: 0,
      })

      await useGitStore.getState().refreshStatus('/tmp/repo')

      expect(useGitStore.getState().statusError).toBeNull()
      expect(useGitStore.getState().status?.branch).toBe('dev')
    })
  })

  // ── refreshBranches ──

  describe('refreshBranches', () => {
    it('clears branches and error when projectPath is null', async () => {
      useGitStore.setState({
        branches: { currentBranch: 'main', branches: [] },
        branchesError: 'old error',
      })

      await useGitStore.getState().refreshBranches(null)

      expect(useGitStore.getState().branches).toBeNull()
      expect(useGitStore.getState().branchesError).toBeNull()
      expect(apiMock.listGitBranches).not.toHaveBeenCalled()
    })

    it('sets branchesError when listGitBranches throws an Error', async () => {
      apiMock.listGitBranches.mockRejectedValue(new Error('permission denied'))

      await useGitStore.getState().refreshBranches('/tmp/repo')

      expect(useGitStore.getState().branches).toBeNull()
      expect(useGitStore.getState().branchesError).toBe('permission denied')
    })

    it('sets fallback branchesError when thrown value is not an Error', async () => {
      apiMock.listGitBranches.mockRejectedValue(42)

      await useGitStore.getState().refreshBranches('/tmp/repo')

      expect(useGitStore.getState().branchesError).toBe('Failed to load Git branches.')
    })

    it('clears branchesError on success', async () => {
      useGitStore.setState({ branchesError: 'previous' })

      apiMock.listGitBranches.mockResolvedValue({
        currentBranch: 'main',
        branches: [],
      })

      await useGitStore.getState().refreshBranches('/tmp/repo')

      expect(useGitStore.getState().branchesError).toBeNull()
      expect(useGitStore.getState().branches).toEqual({
        currentBranch: 'main',
        branches: [],
      })
    })
  })

  // ── commit ──

  describe('commit', () => {
    it('sets isCommitting during commit and resets after success', async () => {
      apiMock.commitGit.mockResolvedValue({
        ok: true,
        commitHash: 'abc123',
        summary: '1 file changed',
      })
      apiMock.getGitStatus.mockResolvedValue({
        branch: 'main',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 1,
        behind: 0,
      })

      const result = await useGitStore.getState().commit('/tmp/repo', {
        message: 'test commit',
        amend: false,
        paths: ['file.ts'],
      })

      expect(result).toEqual({ ok: true, commitHash: 'abc123', summary: '1 file changed' })
      expect(useGitStore.getState().isCommitting).toBe(false)
      // Refreshes status on success
      expect(apiMock.getGitStatus).toHaveBeenCalledWith('/tmp/repo')
    })

    it('does not refresh status when commit result is not ok', async () => {
      apiMock.commitGit.mockResolvedValue({
        ok: false,
        code: 'nothing-to-commit',
        message: 'Nothing to commit.',
      })

      const result = await useGitStore.getState().commit('/tmp/repo', {
        message: 'empty commit',
        amend: false,
        paths: [],
      })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(useGitStore.getState().isCommitting).toBe(false)
    })

    it('resets isCommitting even when commitGit throws', async () => {
      apiMock.commitGit.mockRejectedValue(new Error('IPC failure'))

      await expect(
        useGitStore.getState().commit('/tmp/repo', {
          message: 'fail',
          amend: false,
          paths: [],
        }),
      ).rejects.toThrow('IPC failure')

      expect(useGitStore.getState().isCommitting).toBe(false)
    })
  })

  // ── createBranch ──

  describe('createBranch', () => {
    it('refreshes status and branches on successful creation', async () => {
      apiMock.createGitBranch.mockResolvedValue({
        ok: true,
        message: 'Created branch feature/new.',
      })
      apiMock.getGitStatus.mockResolvedValue({
        branch: 'feature/new',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
      })
      apiMock.listGitBranches.mockResolvedValue({
        currentBranch: 'feature/new',
        branches: [],
      })

      const result = await useGitStore.getState().createBranch('/tmp/repo', {
        name: 'feature/new',
        checkout: true,
      })

      expect(result).toEqual({ ok: true, message: 'Created branch feature/new.' })
      expect(apiMock.getGitStatus).toHaveBeenCalledWith('/tmp/repo')
      expect(apiMock.listGitBranches).toHaveBeenCalledWith('/tmp/repo')
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when creation fails', async () => {
      apiMock.createGitBranch.mockResolvedValue({
        ok: false,
        code: 'branch-exists',
        message: 'Branch already exists.',
      })

      const result = await useGitStore.getState().createBranch('/tmp/repo', {
        name: 'existing',
      })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(apiMock.listGitBranches).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('resets isBranchActionRunning even on IPC throw', async () => {
      apiMock.createGitBranch.mockRejectedValue(new Error('timeout'))

      await expect(
        useGitStore.getState().createBranch('/tmp/repo', { name: 'boom' }),
      ).rejects.toThrow('timeout')

      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })

  // ── renameBranch ──

  describe('renameBranch', () => {
    it('refreshes status and branches on successful rename', async () => {
      apiMock.renameGitBranch.mockResolvedValue({
        ok: true,
        message: 'Renamed branch.',
      })
      apiMock.getGitStatus.mockResolvedValue({
        branch: 'new-name',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
      })
      apiMock.listGitBranches.mockResolvedValue({
        currentBranch: 'new-name',
        branches: [],
      })

      const result = await useGitStore.getState().renameBranch('/tmp/repo', {
        from: 'old-name',
        to: 'new-name',
      })

      expect(result.ok).toBe(true)
      expect(apiMock.getGitStatus).toHaveBeenCalledWith('/tmp/repo')
      expect(apiMock.listGitBranches).toHaveBeenCalledWith('/tmp/repo')
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when rename fails', async () => {
      apiMock.renameGitBranch.mockResolvedValue({
        ok: false,
        code: 'invalid-name',
        message: 'Invalid branch name.',
      })

      const result = await useGitStore.getState().renameBranch('/tmp/repo', {
        from: 'old',
        to: '..bad',
      })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('resets isBranchActionRunning on IPC throw', async () => {
      apiMock.renameGitBranch.mockRejectedValue(new Error('crash'))

      await expect(
        useGitStore.getState().renameBranch('/tmp/repo', { from: 'a', to: 'b' }),
      ).rejects.toThrow('crash')

      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })

  // ── setUpstream ──

  describe('setUpstream', () => {
    it('refreshes status and branches on successful upstream set', async () => {
      apiMock.setGitBranchUpstream.mockResolvedValue({
        ok: true,
        message: 'Upstream set.',
      })
      apiMock.getGitStatus.mockResolvedValue({
        branch: 'feature',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
      })
      apiMock.listGitBranches.mockResolvedValue({
        currentBranch: 'feature',
        branches: [],
      })

      const result = await useGitStore.getState().setUpstream('/tmp/repo', {
        name: 'feature',
        upstream: 'origin/feature',
      })

      expect(result.ok).toBe(true)
      expect(apiMock.getGitStatus).toHaveBeenCalledWith('/tmp/repo')
      expect(apiMock.listGitBranches).toHaveBeenCalledWith('/tmp/repo')
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when setUpstream fails', async () => {
      apiMock.setGitBranchUpstream.mockResolvedValue({
        ok: false,
        code: 'upstream-not-found',
        message: 'Remote tracking branch not found.',
      })

      const result = await useGitStore.getState().setUpstream('/tmp/repo', {
        name: 'feature',
        upstream: 'origin/missing',
      })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('resets isBranchActionRunning on IPC throw', async () => {
      apiMock.setGitBranchUpstream.mockRejectedValue(new Error('net error'))

      await expect(
        useGitStore.getState().setUpstream('/tmp/repo', {
          name: 'x',
          upstream: 'origin/x',
        }),
      ).rejects.toThrow('net error')

      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })

  // ── checkoutBranch (additional error path) ──

  describe('checkoutBranch', () => {
    it('resets isBranchActionRunning on IPC throw', async () => {
      apiMock.checkoutGitBranch.mockRejectedValue(new Error('checkout failed'))

      await expect(
        useGitStore.getState().checkoutBranch('/tmp/repo', { name: 'broken' }),
      ).rejects.toThrow('checkout failed')

      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when checkout result is not ok', async () => {
      apiMock.checkoutGitBranch.mockResolvedValue({
        ok: false,
        code: 'dirty-worktree',
        message: 'Uncommitted changes.',
      })

      const result = await useGitStore.getState().checkoutBranch('/tmp/repo', {
        name: 'dirty',
      })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(apiMock.listGitBranches).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })

  // ── deleteBranch (additional paths not covered by integration test) ──

  describe('deleteBranch', () => {
    it('refreshes on successful deletion', async () => {
      apiMock.deleteGitBranch.mockResolvedValue({
        ok: true,
        message: 'Deleted branch old-feature.',
      })
      apiMock.getGitStatus.mockResolvedValue({
        branch: 'main',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
      })
      apiMock.listGitBranches.mockResolvedValue({
        currentBranch: 'main',
        branches: [],
      })

      const result = await useGitStore.getState().deleteBranch('/tmp/repo', {
        name: 'old-feature',
        force: true,
      })

      expect(result.ok).toBe(true)
      expect(apiMock.getGitStatus).toHaveBeenCalledWith('/tmp/repo')
      expect(apiMock.listGitBranches).toHaveBeenCalledWith('/tmp/repo')
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('resets isBranchActionRunning on IPC throw', async () => {
      apiMock.deleteGitBranch.mockRejectedValue(new Error('IPC down'))

      await expect(
        useGitStore.getState().deleteBranch('/tmp/repo', { name: 'x', force: false }),
      ).rejects.toThrow('IPC down')

      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })
})
