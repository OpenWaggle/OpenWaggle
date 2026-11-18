import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { invalidateVcsStatus, readLocalVcsStatus } from '../vcs-status-cache'
import { createRepositoryWithWorktree } from './commit.test-harness'

describe('VCS status cache worktree identity', () => {
  beforeEach(() => invalidateVcsStatus())

  it('shares aliases within one checkout but isolates linked Session worktrees', async () => {
    const { repository, worktree } = await createRepositoryWithWorktree()
    const openedSubdirectory = path.join(worktree, 'packages', 'app')
    await mkdir(openedSubdirectory, { recursive: true })
    await writeFile(path.join(openedSubdirectory, 'session-only.txt'), 'worker change\n')

    const [primary, worker, workerAlias] = await Promise.all([
      readLocalVcsStatus(repository),
      readLocalVcsStatus(worktree),
      readLocalVcsStatus(openedSubdirectory),
    ])

    expect(primary).toMatchObject({
      ok: true,
      status: { refName: 'main', hasWorkingTreeChanges: false },
    })
    expect(worker).toMatchObject({
      ok: true,
      status: { refName: 'ow/session-test', hasWorkingTreeChanges: true },
    })
    expect(workerAlias).toEqual(worker)
  })
})
