import fs from 'node:fs'
import path from 'node:path'

/**
 * Caches that tools keep in the temporary directory on purpose, reused across processes: jiti's
 * transpile cache (Pi extension loading), Node's module compile cache, and tsx's cache
 * (`tsx-<uid>`, from tests that run scripts with tsx). Code under test creates them, but they are
 * not a test's own temporary files.
 */
const TEMPORARY_DIRECTORY_CACHE_ENTRIES: ReadonlySet<string> = new Set(['jiti', 'node-compile-cache'])
const TSX_CACHE_ENTRY = /^tsx-[\w-]+$/

function isToolCache(entry: string) {
  return TEMPORARY_DIRECTORY_CACHE_ENTRIES.has(entry) || TSX_CACHE_ENTRY.test(entry)
}

const TEMPORARY_DIRECTORY_VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const
const LEAK_CONTENT_SAMPLE = 5
const REMOVE_RETRY_COUNT = 10
const REMOVE_RETRY_DELAY_MS = 100
// Windows keeps a file busy for a moment after its last handle closes.
const REMOVE_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: REMOVE_RETRY_COUNT,
  retryDelay: REMOVE_RETRY_DELAY_MS,
} as const

/** The entries of a test file's temporary directory that the file should have removed. */
export function temporaryDirectoryLeaks(entries: readonly string[]): string[] {
  return entries.filter((entry) => !isToolCache(entry)).sort()
}

export interface TestTemporaryDirectory {
  /** The file's own directory under the run root; it also holds the isolated home. */
  readonly root: string
  /** What TMPDIR, TMP, and TEMP point to while the file runs. */
  readonly temporaryDirectory: string
  /**
   * Removes the file's directory and restores the environment, then throws when the file left
   * anything in its temporary directory.
   */
  readonly finish: (testPath: string | undefined) => void
}

/** A leaked entry, with the first few files inside it: they tell which code wrote it. */
function describeLeak(temporaryDirectory: string, entry: string) {
  const entryPath = path.join(temporaryDirectory, entry)
  let contents: string[] = []
  try {
    if (fs.lstatSync(entryPath).isDirectory()) {
      contents = fs
        .readdirSync(entryPath, { recursive: true })
        .map(String)
        .sort()
        .slice(0, LEAK_CONTENT_SAMPLE)
    }
  } catch {
    // Removed while it was described; the entry name still identifies it.
  }
  return contents.length === 0 ? entry : `${entry} (${contents.join(', ')})`
}

/**
 * Points TMPDIR, TMP, and TEMP (`os.tmpdir()` on every platform) at a directory of the test file's
 * own, so a leaked directory is traced to the file that left it even while files run in parallel.
 */
export function createTestTemporaryDirectory(input: {
  readonly runRoot: string
  readonly environment: NodeJS.ProcessEnv
}): TestTemporaryDirectory {
  const root = fs.mkdtempSync(path.join(input.runRoot, 'f'))
  const temporaryDirectory = path.join(root, 'tmp')
  fs.mkdirSync(temporaryDirectory)
  const previous = TEMPORARY_DIRECTORY_VARIABLES.map((name) => [name, input.environment[name]] as const)
  for (const name of TEMPORARY_DIRECTORY_VARIABLES) input.environment[name] = temporaryDirectory

  return {
    root,
    temporaryDirectory,
    finish(testPath) {
      const leaks = temporaryDirectoryLeaks(fs.readdirSync(temporaryDirectory)).map((entry) =>
        describeLeak(temporaryDirectory, entry),
      )
      fs.rmSync(root, REMOVE_OPTIONS)
      for (const [name, value] of previous) {
        if (value === undefined) delete input.environment[name]
        else input.environment[name] = value
      }
      if (leaks.length === 0) return
      const file = testPath ? path.relative(process.cwd(), testPath) : 'A test file'
      throw new Error(
        `${file} left ${String(leaks.length)} ${leaks.length === 1 ? 'entry' : 'entries'} in its temporary directory: ${leaks.join(', ')}. ` +
          'Remove every temporary file and directory a test creates in its teardown.',
      )
    },
  }
}
