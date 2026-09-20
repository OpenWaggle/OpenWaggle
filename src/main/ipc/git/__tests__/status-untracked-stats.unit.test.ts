import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGit } from '../shared'
import { resolveUntrackedStatus } from '../status-untracked-stats'

vi.mock('../shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared')>()),
  runGit: vi.fn(),
}))

const gitResult = (stdout = '', code = 0) => ({ stdout, stderr: '', code })

describe('untracked status statistics', () => {
  beforeEach(() => {
    vi.mocked(runGit).mockReset()
  })

  it('uses one scratch-index diff instead of one child process per untracked file', async () => {
    vi.mocked(runGit).mockImplementation(async (_projectPath, args) => {
      if (args.includes('ls-files')) return gitResult('one.txt\0asset.bin\0empty.txt\0')
      if (args[0] === 'read-tree') return gitResult()
      if (args[0] === 'add') return gitResult()
      if (args.includes('--numstat')) return gitResult('2\t0\tone.txt\n-\t-\tasset.bin\n')
      throw new Error(`Unexpected Git command: ${args.join(' ')}`)
    })

    const result = await resolveUntrackedStatus('/project', [
      { path: 'one.txt', status: 'untracked', staged: false, unstaged: true },
      { path: 'asset.bin', status: 'untracked', staged: false, unstaged: true },
      { path: 'empty.txt', status: 'untracked', staged: false, unstaged: true },
    ])

    expect(result.numstat).toEqual(
      new Map([
        ['one.txt', { additions: 2, deletions: 0 }],
        ['asset.bin', { additions: 0, deletions: 0 }],
      ]),
    )
    expect(runGit).toHaveBeenCalledTimes(4)
    expect(vi.mocked(runGit).mock.calls.some(([, args]) => args.includes('--no-index'))).toBe(false)
  })

  it('uses an empty scratch index for an unborn repository', async () => {
    vi.mocked(runGit).mockImplementation(async (_projectPath, args) => {
      if (args.includes('ls-files')) return gitResult('first.txt\0')
      if (args[0] === 'read-tree' && args[1] === 'HEAD') return gitResult('', 128)
      if (args[0] === 'read-tree' && args[1] === '--empty') return gitResult()
      if (args[0] === 'add') return gitResult()
      if (args.includes('--numstat')) return gitResult('1\t0\tfirst.txt\n')
      throw new Error(`Unexpected Git command: ${args.join(' ')}`)
    })

    const result = await resolveUntrackedStatus('/project', [
      { path: 'first.txt', status: 'untracked', staged: false, unstaged: true },
    ])

    expect(result.numstat.get('first.txt')).toEqual({ additions: 1, deletions: 0 })
    expect(runGit).toHaveBeenCalledTimes(5)
  })
})
