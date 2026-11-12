/**
 * Stable release notes come from the hand-written root CHANGELOG.md (docs/release-and-versioning.md,
 * "Release Notes"); prereleases use GitHub's generated notes.
 *
 * Dependency-free on purpose: the release job runs it with Node's built-in type stripping, without
 * installing the workspace.
 *
 *   node scripts/app-release-notes.ts check --version 1.0.0
 *   node scripts/app-release-notes.ts write --version 1.0.0 --output notes.md
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const CHANGELOG_PATH = 'CHANGELOG.md'
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u
const ENTRY_HEADING_PATTERN = /^## \[?v?(?<version>\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s.*)?$/u
const ARG_VALUE_OFFSET = 1
const CLI_COMMAND_INDEX = 2

export function isStableAppVersion(version: string) {
  return STABLE_VERSION_PATTERN.test(version)
}

/**
 * The body under a `## 1.0.0` (or `## [1.0.0] - date`) heading, up to the next `## ` heading, or
 * null when the entry is missing or empty.
 */
export function changelogEntry(changelog: string, version: string) {
  const lines = changelog.split(/\r?\n/u)
  const start = lines.findIndex(
    (line) => ENTRY_HEADING_PATTERN.exec(line)?.groups?.version === version,
  )
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
  return body === '' ? null : body
}

function requiredEntry(version: string) {
  const changelog = fs.existsSync(CHANGELOG_PATH) ? fs.readFileSync(CHANGELOG_PATH, 'utf8') : ''
  const entry = changelogEntry(changelog, version)
  if (!entry) {
    throw new Error(
      `Stable ${version} needs a hand-written "## ${version}" entry in ${CHANGELOG_PATH} on main before it can be released.`,
    )
  }
  return entry
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + ARG_VALUE_OFFSET] : undefined
  if (!value) throw new Error(`Missing required argument ${name}.`)
  return value
}

function runCli() {
  const command = process.argv[CLI_COMMAND_INDEX]
  const version = argument('--version')
  if (!isStableAppVersion(version)) {
    process.stdout.write(`${version} is a prerelease; it uses generated release notes.\n`)
    return
  }
  if (command === 'check') {
    requiredEntry(version)
    process.stdout.write(`${CHANGELOG_PATH} has release notes for ${version}.\n`)
    return
  }
  if (command === 'write') {
    fs.writeFileSync(argument('--output'), `${requiredEntry(version)}\n`)
    return
  }
  throw new Error(`Unsupported app release notes command: ${String(command)}.`)
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
