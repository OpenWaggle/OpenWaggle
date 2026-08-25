import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { getGitStatus } from '../status-service'

const execFileAsync = promisify(execFile)
let repositoryPath: string | null = null

/** A name git C-quotes by default, which is the whole point of this test. */
const ACCENTED_NAME = 'café.txt'

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('status paths that git would quote', () => {
  it('reports the real path, so it can be used as a pathspec', async () => {
    /*
     * `core.quotePath` defaults to true, so git prints `"caf\303\251.txt"` and the parser could only
     * strip the quotes - leaving the escape sequence as a literal. Those parsed paths are the pathspec
     * of every panel commit, so one accented filename anywhere in the working tree made staging fail
     * with "pathspec ... did not match any files" and committed nothing.
     */
    const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-quoted-paths-'))
    repositoryPath = repository
    await git(repository, ['init', '--initial-branch=main'])
    await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
    await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
    await writeFile(path.join(repository, ACCENTED_NAME), 'seed\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'chore: baseline'])
    await writeFile(path.join(repository, ACCENTED_NAME), 'changed\n')

    const status = await getGitStatus(repository)
    const reported = status.changedFiles.map((file) => file.path)

    expect(reported).toEqual([ACCENTED_NAME])
    // And git accepts it as a pathspec, which is what the commit phase does with it.
    await expect(git(repository, ['add', '--', ACCENTED_NAME])).resolves.toBeDefined()
    expect(reported.some((entry) => entry.includes('\\'))).toBe(false)
  })

  it('reports the real path in a repository with no first commit', async () => {
    /*
     * The numstat fallback taken when `diff --numstat HEAD` fails - every repository before its first
     * commit - did not disable quoting, and `buildChangedFiles` adds any numstat path the porcelain does
     * not have. `caf\\303\\251.txt` and `café.txt` are different keys, so a phantom entry appeared and
     * was handed to the commit as a pathspec.
     */
    const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-quoted-unborn-'))
    repositoryPath = repository
    await git(repository, ['init', '--initial-branch=main'])
    await writeFile(path.join(repository, ACCENTED_NAME), 'content\n')
    await git(repository, ['add', '--all'])

    const status = await getGitStatus(repository)

    expect(status.changedFiles.map((file) => file.path)).toEqual([ACCENTED_NAME])
  })
})
