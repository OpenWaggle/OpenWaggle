/**
 * A `.openwaggle/mcp.json` the migration creates (not the user) inside a git work tree would show
 * up as an untracked file, and agent turns would report it as a change. Its path is added to the
 * repository's `.git/info/exclude`, which is local to the clone: never `.gitignore` or another
 * tracked file. A path the repository already ignores or tracks is left alone.
 */
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { runGit } from '../../git/run-git'

/** Local git commands only; a stuck one must not hold up the migration. */
const GIT_TIMEOUT_MS = 10_000
const GIT_OPTIONS = { timeoutMs: GIT_TIMEOUT_MS }

async function readOptional(filePath: string) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  }
}

/**
 * An exclude line that matches exactly this path: git reads `\`, `*`, `?` and `[` as pattern
 * characters, and drops trailing spaces, unless escaped. Anchored with `/`, so a leading `!` or `#`
 * is literal.
 */
function excludeLine(gitPath: string) {
  const escaped = gitPath.replace(/[\\*?[]/g, (character) => `\\${character}`)
  return `/${escaped.replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))}`
}

/** Whether the ignore rules match the path itself, whatever the index holds. */
async function isIgnored(root: string, gitPath: string) {
  const result = await runGit(
    root,
    // check-ignore takes no literal pathspecs; --no-index judges the rules alone, and `./` keeps a
    // path that starts with ':' from being read as pathspec magic.
    ['check-ignore', '--no-index', '-q', '--', `./${gitPath}`],
    GIT_OPTIONS,
  )
  return result.code === 0
}

/** True when the path was added to `.git/info/exclude`, and git now ignores it. */
export async function keepMcpFileOutOfGit(filePath: string) {
  // Git reports real paths (macOS /tmp is /private/tmp).
  const directory = await realpath(path.dirname(filePath))
  const top = await runGit(directory, ['rev-parse', '--show-toplevel'], GIT_OPTIONS)
  if (top.code !== 0) return false
  const root = top.stdout.trim()
  const relative = path.relative(root, path.join(directory, path.basename(filePath)))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
  const gitPath = relative.split(path.sep).join('/')
  // An exclude file has one pattern per line; such a path cannot be written as one.
  if (/[\r\n]/.test(gitPath)) return false
  // The path literally, not as a pathspec glob a sibling such as `x a/` could match.
  const tracked = await runGit(
    root,
    ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', gitPath],
    GIT_OPTIONS,
  )
  if (tracked.code === 0) return false
  const ignored = await isIgnored(root, gitPath)
  if (ignored) return false
  const location = await runGit(root, ['rev-parse', '--git-path', 'info/exclude'], GIT_OPTIONS)
  if (location.code !== 0) return false
  const excludePath = path.resolve(root, location.stdout.trim())
  const current = await readOptional(excludePath)
  const line = excludeLine(gitPath)
  if (current.split(/\r?\n/).includes(line)) return false
  await mkdir(path.dirname(excludePath), { recursive: true })
  const separator = current === '' || current.endsWith('\n') ? '' : '\n'
  await appendFile(
    excludePath,
    `${separator}# OpenWaggle created this MCP file while upgrading; it stays out of git.\n${line}\n`,
  )
  // The line must match the file: confirmed by git itself.
  if (!(await isIgnored(root, gitPath)))
    throw new Error(`git does not ignore ${gitPath} after excluding it`)
  return true
}
