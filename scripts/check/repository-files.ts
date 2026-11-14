/**
 * Repository file lists from git, which already knows them: one `git ls-files` call instead of a
 * directory walk that opens every ignored folder.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_OUTPUT_MAX_BUFFER_BYTES = 64 * 1024 * 1024
/** Parallel reads in flight. Each open costs milliseconds where endpoint security scans it. */
const READ_CONCURRENCY = 64

async function git(args: readonly string[], cwd: string) {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: GIT_OUTPUT_MAX_BUFFER_BYTES,
  })
  return stdout
}

function nulSeparated(output: string) {
  return output.split('\0').filter((entry) => entry !== '')
}

/**
 * Tracked and untracked-but-not-ignored files that exist in the working tree, sorted, with `/`
 * separators (git's own form on every platform).
 */
export async function listRepositoryFiles(cwd = process.cwd()) {
  const [present, deleted] = await Promise.all([
    git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd),
    git(['ls-files', '-z', '--deleted'], cwd),
  ])
  const removed = new Set(nulSeparated(deleted))
  return [...new Set(nulSeparated(present))].filter((file) => !removed.has(file)).sort()
}

/**
 * Files that differ from the merge base with `base` (committed, staged, unstaged or untracked),
 * excluding deletions.
 */
export async function listChangedFiles(base: string, cwd = process.cwd()) {
  const mergeBase = (await git(['merge-base', 'HEAD', base], cwd)).trim()
  const [changed, untracked] = await Promise.all([
    git(['diff', '-z', '--name-only', '--diff-filter=d', '--no-renames', mergeBase], cwd),
    git(['ls-files', '-z', '--others', '--exclude-standard'], cwd),
  ])
  return [...new Set([...nulSeparated(changed), ...nulSeparated(untracked)])].sort()
}

/** Files added since the merge base with `base` (committed, staged, unstaged or untracked). */
export async function listAddedFiles(base: string, cwd = process.cwd()) {
  const mergeBase = (await git(['merge-base', 'HEAD', base], cwd)).trim()
  const [added, untracked] = await Promise.all([
    git(['diff', '-z', '--name-only', '--diff-filter=A', '--no-renames', mergeBase], cwd),
    git(['ls-files', '-z', '--others', '--exclude-standard'], cwd),
  ])
  return [...new Set([...nulSeparated(added), ...nulSeparated(untracked)])].sort()
}

/** Reads files with a bounded number of opens in flight; the map keeps the input order. */
export async function readFiles(files: readonly string[], cwd = process.cwd()) {
  const contents = Array.from({ length: files.length }, () => '')
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const index = next
      next += 1
      const file = files[index]
      if (file === undefined) continue
      contents[index] = await readFile(path.join(cwd, file), 'utf8')
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker))
  return new Map(files.map((file, index) => [file, contents[index] ?? '']))
}
