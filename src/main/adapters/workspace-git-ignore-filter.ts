import { execFile } from 'node:child_process'
import path from 'node:path'
import { getSafeChildEnv } from '../env'

const GIT_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024
const GIT_TIMEOUT_MS = 30_000

function git(root: string, args: readonly string[], input?: string) {
  return new Promise<{ readonly code: number; readonly stdout: string }>((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', root, ...args],
      {
        env: getSafeChildEnv(),
        maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error) return resolve({ code: 0, stdout })
        const code = typeof error.code === 'number' ? error.code : -1
        // `check-ignore` exits 1 when nothing is ignored.
        if (code === 1) return resolve({ code, stdout })
        reject(error)
      },
    )
    if (input !== undefined) child.stdin?.end(input)
  })
}

/** `a/b/c.ts` -> `a/`, `a/b/`: the folders of a root-relative path, as git names directories. */
function parentFolders(relative: string) {
  const folders: string[] = []
  for (let slash = relative.indexOf('/'); slash !== -1; slash = relative.indexOf('/', slash + 1)) {
    folders.push(relative.slice(0, slash + 1))
  }
  return folders
}

function entries(stdout: string) {
  return stdout.split('\0').filter((entry) => entry.length > 0)
}

/**
 * Which workspace paths git ignores, so the file watcher does not report them (D10). The ignored
 * files and directories git lists at start (`ls-files --others --ignored --directory`, a few
 * entries even for large `node_modules` or build trees) answer most paths at once; a changed path
 * they do not cover is asked about in its batch (`check-ignore --stdin`), since a new file can
 * match a pattern. A changed `.gitignore` or `info/exclude` reloads the list.
 */
export class WorkspaceGitIgnoreFilter {
  private ignoredDirectories = new Set<string>()
  private ignoredFiles = new Set<string>()
  private loading: Promise<void> | undefined

  private constructor(
    private readonly root: string,
    /**
     * The repository's `info/exclude`, absolute. A linked worktree's is in the common git
     * directory, outside the worktree, so the watcher watches it on its own.
     */
    readonly excludeFile: string | undefined,
  ) {}

  /** The filter of a git working tree, or undefined for a folder git does not manage. */
  static async create(root: string) {
    try {
      const inside = await git(root, ['rev-parse', '--is-inside-work-tree'])
      if (inside.stdout.trim() !== 'true') return undefined
    } catch {
      return undefined
    }
    const exclude = await git(root, ['rev-parse', '--git-path', 'info/exclude']).catch(
      () => undefined,
    )
    const excludePath = exclude?.stdout.trim()
    const filter = new WorkspaceGitIgnoreFilter(
      root,
      excludePath ? path.resolve(root, excludePath) : undefined,
    )
    await filter.reload()
    return filter
  }

  /** Reads the ignore list again, after a source outside the batches changed (`info/exclude`). */
  refresh() {
    return this.reload()
  }

  /** Whether the listed ignored files or directories cover the root-relative `/` path. */
  isKnownIgnored(relative: string) {
    if (this.ignoredFiles.has(relative)) return true
    let slash = relative.indexOf('/')
    while (slash !== -1) {
      if (this.ignoredDirectories.has(relative.slice(0, slash + 1))) return true
      slash = relative.indexOf('/', slash + 1)
    }
    return this.ignoredDirectories.has(`${relative}/`)
  }

  /** The changed paths git does not ignore; the ignore list reloads when its sources changed. */
  async keepNotIgnored(relatives: readonly string[]) {
    if (
      relatives.some((relative) => /(?:^|\/)\.gitignore$|^\.git\/info\/exclude$/u.test(relative))
    ) {
      await this.reload()
    }
    const unknown = relatives.filter((relative) => !this.isKnownIgnored(relative))
    if (unknown.length === 0) return []
    // Each path's folders are asked about too: one git ignores (a `build/` or `.venv/` created
    // after the list was read) then answers its later changes without asking git again.
    const folders = [...new Set(unknown.flatMap(parentFolders))]
    try {
      const result = await git(
        this.root,
        ['check-ignore', '--stdin', '-z'],
        `${[...unknown, ...folders].join('\0')}\0`,
      )
      const ignored = new Set(entries(result.stdout))
      for (const folder of folders) if (ignored.has(folder)) this.ignoredDirectories.add(folder)
      return unknown.filter((relative) => !ignored.has(relative) && !this.isKnownIgnored(relative))
    } catch {
      return unknown
    }
  }

  private reload() {
    this.loading ??= git(this.root, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
    ])
      .then((result) => {
        const listed = entries(result.stdout)
        this.ignoredDirectories = new Set(listed.filter((entry) => entry.endsWith('/')))
        this.ignoredFiles = new Set(listed.filter((entry) => !entry.endsWith('/')))
      })
      .catch(() => undefined)
      .finally(() => {
        this.loading = undefined
      })
    return this.loading
  }
}
