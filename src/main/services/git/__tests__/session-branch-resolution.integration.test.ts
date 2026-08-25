import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { legacySessionWorktreeBranch, sessionWorktreeBranch } from '@shared/utils/worktree'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSessionWorktreeBranch } from '../session-branch-resolution'

const execFileAsync = promisify(execFile)
let repositoryPath: string | null = null

/** A session id long enough that its legacy 8-character branch name differs from the full one. */
const SESSION_ID = '01a014fc-7ee0-71da-bfa9-95f630d6fa24'

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-session-branch-'))
  repositoryPath = repository
  await git(repository, ['init', '--initial-branch=main'])
  await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
  await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
  await writeFile(path.join(repository, 'seed.txt'), 'seed\n')
  await git(repository, ['add', '--all'])
  await git(repository, ['commit', '-m', 'chore: baseline'])
  return repository
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('resolveSessionWorktreeBranch', () => {
  it("reuses a legacy session branch that still holds the agent's commits", async () => {
    /*
     * Sessions born before the current convention own a branch named from the first 8 characters of
     * their id. Creating the current name instead left those commits stranded on the old branch -
     * the loss this resolution exists to prevent - and afterwards both branches existed, so the
     * commits became unreachable from the app entirely.
     */
    const repository = await createRepository()
    const legacy = legacySessionWorktreeBranch(SESSION_ID)
    await git(repository, ['branch', legacy])

    expect(await resolveSessionWorktreeBranch(repository, SESSION_ID)).toBe(legacy)
    expect(legacy).not.toBe(sessionWorktreeBranch(SESSION_ID))
  })

  it('prefers the current name when it exists, even alongside a legacy branch', async () => {
    // Once a session has a current-convention branch, that is the one carrying its work.
    const repository = await createRepository()
    await git(repository, ['branch', legacySessionWorktreeBranch(SESSION_ID)])
    await git(repository, ['branch', sessionWorktreeBranch(SESSION_ID)])

    expect(await resolveSessionWorktreeBranch(repository, SESSION_ID)).toBe(
      sessionWorktreeBranch(SESSION_ID),
    )
  })

  it('uses the current name for a session with no branch yet', async () => {
    const repository = await createRepository()

    expect(await resolveSessionWorktreeBranch(repository, SESSION_ID)).toBe(
      sessionWorktreeBranch(SESSION_ID),
    )
  })
})
