/**
 * What the no-cheating check reads from git: the files changed between a base commit and the
 * working tree (untracked and deleted files included), the file listing, and each file's text at
 * the base. Base texts come from one `git cat-file --batch` process, not one `git show` per file.
 */
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { namedGroups } from '@shared/utils/regex-named-groups'

const execFile = promisify(execFileCallback)
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024
const NEWLINE = 0x0a
/** A `--name-status -z` rename: its status, the old path and the new path. */
const RENAME_FIELDS = 3

async function git(root: string, args: readonly string[]) {
  const { stdout } = await execFile('git', [...args], { cwd: root, maxBuffer: GIT_OUTPUT_LIMIT })
  return stdout
}

function nulSeparated(output: string) {
  return output.split('\0').filter((entry) => entry !== '')
}

/** Files that differ between `base` and the working tree, and untracked files, sorted. */
export async function changedSince(root: string, base: string) {
  const [diff, untracked] = await Promise.all([
    git(root, ['diff', '--name-only', '-z', '--no-renames', base, '--']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  return [...new Set([...nulSeparated(diff), ...nulSeparated(untracked)])].sort()
}

/** Files git sees as renamed or moved since `base` (50% similar or more), by their old path. */
export async function movedSince(root: string, base: string) {
  const entries = nulSeparated(
    await git(root, ['diff', '--name-status', '-z', '-M50%', '--diff-filter=R', base, '--']),
  )
  const moved = new Set<string>()
  // Each rename is `R<score>`, the old path, then the new path.
  for (let index = 0; index + RENAME_FIELDS - 1 < entries.length; index += RENAME_FIELDS) {
    const from = entries[index + 1]
    if (from !== undefined) moved.add(from)
  }
  return moved
}

/** Tracked and untracked files in the working tree, NUL-separated; deleted ones left out. */
export async function listing(root: string) {
  const [files, deleted] = await Promise.all([
    git(root, ['ls-files', '-co', '--exclude-standard', '-z']),
    git(root, ['ls-files', '--deleted', '-z']),
  ])
  const gone = new Set(nulSeparated(deleted))
  return nulSeparated(files)
    .filter((file) => !gone.has(file))
    .join('\0')
}

/** Each file's text at `base`; a file missing there maps to undefined. */
export function textsAt(root: string, base: string, files: readonly string[]) {
  return new Promise<Map<string, string | undefined>>((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: root })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git cat-file exited with ${String(code)}`))
        return
      }
      resolve(parseBatch(Buffer.concat(chunks), files))
    })
    child.stdin.end(files.map((file) => `${base}:${file}\n`).join(''))
  })
}

/** Reads `git cat-file --batch` output: `<sha> <type> <size>\n<content>\n` or `<name> missing\n`. */
function parseBatch(output: Buffer, files: readonly string[]) {
  const texts = new Map<string, string | undefined>()
  let offset = 0
  for (const file of files) {
    const end = output.indexOf(NEWLINE, offset)
    const header = output.subarray(offset, end).toString('utf8')
    offset = end + 1
    const size = namedGroups(/^\S+ blob (?<size>\d+)$/u.exec(header), ['size'])?.size
    if (size === undefined) {
      texts.set(file, undefined)
      continue
    }
    texts.set(file, output.subarray(offset, offset + Number(size)).toString('utf8'))
    offset += Number(size) + 1
  }
  return texts
}
