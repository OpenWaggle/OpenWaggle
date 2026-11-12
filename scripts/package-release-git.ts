import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { Version } from 'release-please/build/src/version.js'

/*
 * Git reads for the package release line check. Everything is read from a revision, not the
 * working tree, so the check sees exactly what a pull request head or release branch contains.
 */

const execFile = promisify(execFileCallback)
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024
const COMMIT_FIELD_COUNT = 2
const COMMIT_MESSAGE_FIELD_OFFSET = 1
const DOCS_LINE_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)$/u

export async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: GIT_MAX_BUFFER_BYTES })
  return stdout
}

export async function gitSucceeds(cwd: string, args: readonly string[]) {
  try {
    await git(cwd, args)
    return true
  } catch {
    return false
  }
}

export async function readJsonAt(cwd: string, revision: string, filePath: string) {
  try {
    const parsed: unknown = JSON.parse(await git(cwd, ['show', `${revision}:${filePath}`]))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

export function stringField(value: object, key: string) {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' ? field : undefined
}

export function objectField(value: object, key: string) {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'object' && field !== null && !Array.isArray(field) ? field : undefined
}

export function parseVersion(version: string) {
  try {
    const parsed = Version.parse(version)
    return parsed.toString() === version ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The component's `<component>-v<version>` tags merged into `to`, oldest first by semver. */
export async function releasedTagVersions(cwd: string, component: string, to: string) {
  return (await git(cwd, ['tag', '--list', `${component}-v*`, '--merged', to]))
    .split('\n')
    .map((tag) => tag.trim().slice(`${component}-v`.length))
    .flatMap((version) => {
      const parsed = parseVersion(version)
      return parsed === undefined ? [] : [parsed]
    })
    .sort((left, right) => left.compare(right))
}

/**
 * The newest commit at or before `to` that set the manifest's entry for `packagePath` to `version`:
 * the merged release pull request. `undefined` if no commit on that history recorded it.
 */
export async function manifestChangeCommit(
  cwd: string,
  to: string,
  manifestPath: string,
  packagePath: string,
  version: string,
) {
  const shas = (await git(cwd, ['log', '--format=%H', to, '--', manifestPath]))
    .split('\n')
    .filter(Boolean)
  for (const sha of shas) {
    const before = await readJsonAt(cwd, `${sha}^`, manifestPath)
    if ((before === undefined ? undefined : stringField(before, packagePath)) !== version) {
      return sha
    }
  }
  return undefined
}

/** Full messages of the commits in `range` that touch `packagePath`, newest first. */
export async function commitsTouching(cwd: string, range: string, packagePath: string) {
  const fields = (
    await git(cwd, ['log', '--format=%H%x00%B%x00', range, '--', `${packagePath}/`])
  ).split('\0')
  const commits: { hash: string; message: string }[] = []
  for (
    let index = 0;
    index + COMMIT_MESSAGE_FIELD_OFFSET < fields.length;
    index += COMMIT_FIELD_COUNT
  ) {
    const hash = fields[index]?.trim() ?? ''
    if (hash.length === 0) continue
    commits.push({ hash, message: (fields[index + COMMIT_MESSAGE_FIELD_OFFSET] ?? '').trim() })
  }
  return commits
}

function lineOrder(line: string): readonly [number, number] {
  const match = DOCS_LINE_PATTERN.exec(line)
  return [Number(match?.groups?.major), Number(match?.groups?.minor)]
}

/** The published `<major>.<minor>` docs directories at `to`, oldest first by number (0.9 before 0.10). */
export async function publishedLinesAt(cwd: string, to: string, root: string) {
  try {
    return (await git(cwd, ['ls-tree', '-d', '--name-only', `${to}:${root}`]))
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => DOCS_LINE_PATTERN.test(entry))
      .sort((left, right) => {
        const [leftMajor, leftMinor] = lineOrder(left)
        const [rightMajor, rightMinor] = lineOrder(right)
        return leftMajor - rightMajor || leftMinor - rightMinor
      })
  } catch {
    return []
  }
}
