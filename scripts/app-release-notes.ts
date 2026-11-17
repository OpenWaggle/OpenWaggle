/**
 * The root CHANGELOG.md (docs/release-and-versioning.md, "Release Notes"). Every app release PR
 * writes its version's entry from the Conventional Commits since the previous release tag, and a
 * Stable release also moves the hand-written notes under `## [Unreleased]` into its entry. The
 * GitHub Release publishes that entry, and the website's changelog page renders the file.
 *
 * Dependency-free on purpose: the release job runs it with Node's built-in type stripping, without
 * installing the workspace.
 *
 *   node scripts/app-release-notes.ts check --version 2.0.0
 *   node scripts/app-release-notes.ts write --version 1.0.0 --output notes.md
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const CHANGELOG_PATH = 'CHANGELOG.md'
export const UNRELEASED_HEADING = '## [Unreleased]'
const REPOSITORY_URL = 'https://github.com/OpenWaggle/OpenWaggle'
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u
const MAJOR_VERSION_PATTERN = /^\d+\.0\.0$/u
const ENTRY_HEADING_PATTERN = /^## \[?v?(?<version>\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s.*)?$/u
const ENTRY_DATE_PATTERN = /^## \[[^\]]+\] - (?<date>\d{4}-\d{2}-\d{2})$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const FENCE_PATTERN = /^[ \t]{0,3}(?<marker>`{3,}|~{3,})/u
const SUBJECT_PATTERN =
  /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?(?<bang>!)?: (?<description>\S.*)$/u
const PULL_REQUEST_SUFFIX_PATTERN = / \(#(?<number>\d+)\)$/u
const BREAKING_FOOTER = 'BREAKING CHANGE'
const SHORT_SHA_LENGTH = 7
const ARG_VALUE_OFFSET = 1
const CLI_COMMAND_INDEX = 2
const BREAKING_TITLE = 'Breaking changes'
const SECTIONS = [
  { title: 'Features', type: 'feat' },
  { title: 'Fixes', type: 'fix' },
  { title: 'Performance', type: 'perf' },
] as const
/** Headings the release PR writes; hand-written notes use their own, such as `### Highlights`. */
export const GENERATED_HEADINGS: readonly string[] = [
  BREAKING_TITLE,
  ...SECTIONS.map(({ title }) => title),
]

export interface ReleaseCommit {
  readonly sha: string
  readonly subject: string
  readonly body: string
}

interface ParsedCommit {
  readonly commit: ReleaseCommit
  readonly type: string
  readonly scope: string | undefined
  readonly description: string
  readonly breaking: boolean
}

export function isStableAppVersion(version: string) {
  return STABLE_VERSION_PATTERN.test(version)
}

function lines(changelog: string) {
  return changelog.split(/\r?\n/u)
}

/** Whether each line is outside a fenced code block, where a `## ` line is a heading. */
function outsideFences(changelogLines: readonly string[]) {
  // The website parser's rule (website/src/lib/changelog.ts): a fence closes only with its own
  // marker character, at least as long as the one that opened it.
  let fence: string | undefined
  return changelogLines.map((line) => {
    const marker = FENCE_PATTERN.exec(line)?.groups?.marker
    const toggles = marker !== undefined && (fence === undefined || marker.startsWith(fence))
    const outside = fence === undefined && !toggles
    if (toggles) fence = fence === undefined ? marker : undefined
    return outside
  })
}

function headingIndex(changelogLines: readonly string[], matches: (line: string) => boolean) {
  const outside = outsideFences(changelogLines)
  return changelogLines.findIndex((line, index) => outside[index] === true && matches(line))
}

function entryHeadingIndex(changelogLines: readonly string[], version: string) {
  return headingIndex(changelogLines, (line) => {
    const { version: entryVersion } = ENTRY_HEADING_PATTERN.exec(line)?.groups ?? {}
    return entryVersion === version
  })
}

function nextSectionIndex(rest: readonly string[]) {
  return headingIndex(rest, (line) => line.startsWith('## '))
}

function sectionBody(rest: readonly string[]) {
  const end = nextSectionIndex(rest)
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
}

/**
 * The body under a `## [1.0.0] - date` (or legacy `## 1.0.0`) heading, up to the next `## `
 * heading, or null when the entry is missing or empty.
 */
export function changelogEntry(changelog: string, version: string) {
  const changelogLines = lines(changelog)
  const start = entryHeadingIndex(changelogLines, version)
  if (start < 0) return null
  const body = sectionBody(changelogLines.slice(start + 1))
  return body === '' ? null : body
}

/** The `YYYY-MM-DD` date of a release PR's `## [version] - date` heading, or null. */
export function changelogEntryDate(changelog: string, version: string) {
  const changelogLines = lines(changelog)
  const heading = changelogLines[entryHeadingIndex(changelogLines, version)] ?? ''
  return ENTRY_DATE_PATTERN.exec(heading)?.groups?.date ?? null
}

function splitAtUnreleased(changelog: string) {
  const changelogLines = lines(changelog)
  const start = headingIndex(changelogLines, (line) => line.trim() === UNRELEASED_HEADING)
  if (start < 0) {
    throw new Error(`${CHANGELOG_PATH} has no "${UNRELEASED_HEADING}" heading.`)
  }
  const after = changelogLines.slice(start + 1)
  const next = nextSectionIndex(after)
  return {
    preamble: changelogLines.slice(0, start).join('\n').trim(),
    unreleased: sectionBody(after),
    released: next < 0 ? '' : after.slice(next).join('\n').trim(),
  }
}

/** The hand-written notes under `## [Unreleased]`, trimmed; empty when there are none. */
export function unreleasedNotes(changelog: string) {
  return splitAtUnreleased(changelog).unreleased
}

/** Hand-written headings that would collide with the headings the release PR writes. */
export function reservedHeadingProblems(notes: string) {
  return lines(notes).flatMap((line) =>
    GENERATED_HEADINGS.some((title) => line.trim() === `### ${title}`)
      ? [
          `"${line.trim()}" is written by the release PR; give hand-written notes another heading, such as "### Highlights".`,
        ]
      : [],
  )
}

function parseCommit(commit: ReleaseCommit) {
  const groups = SUBJECT_PATTERN.exec(commit.subject)?.groups
  if (!groups?.type || !groups.description) return null
  const parsed: ParsedCommit = {
    commit,
    type: groups.type,
    scope: groups.scope,
    description: groups.description,
    breaking: groups.bang === '!' || commit.body.includes(BREAKING_FOOTER),
  }
  return parsed
}

function renderLine({ commit, scope, description }: ParsedCommit) {
  const pullRequest = PULL_REQUEST_SUFFIX_PATTERN.exec(description)
  const number = pullRequest?.groups?.number
  const text = pullRequest ? description.slice(0, pullRequest.index) : description
  const link = number
    ? `[#${number}](${REPOSITORY_URL}/pull/${number})`
    : `[${commit.sha.slice(0, SHORT_SHA_LENGTH)}](${REPOSITORY_URL}/commit/${commit.sha})`
  return `- ${scope ? `**${scope}:** ` : ''}${text} (${link})`
}

function renderSection(title: string, commits: readonly ParsedCommit[]) {
  return commits.length === 0 ? [] : [`### ${title}\n\n${commits.map(renderLine).join('\n')}`]
}

/**
 * Release notes grouped like Release Please's: breaking changes of any type first, then features,
 * fixes and performance work. Other types (docs, chore, test, ...) are left out. Empty when no
 * commit qualifies.
 */
export function generatedReleaseNotes(commits: readonly ReleaseCommit[]) {
  const parsed = commits.flatMap((commit) => parseCommit(commit) ?? [])
  const breaking = parsed.filter((commit) => commit.breaking)
  return [
    ...renderSection(BREAKING_TITLE, breaking),
    ...SECTIONS.flatMap(({ title, type }) =>
      renderSection(
        title,
        parsed.filter((commit) => !commit.breaking && commit.type === type),
      ),
    ),
  ].join('\n\n')
}

export interface PrepareChangelogInput {
  readonly changelog: string
  readonly version: string
  /** `YYYY-MM-DD`, the day the release PR last wrote the entry. */
  readonly date: string
  /** The commits since `previousTag`, newest first, as `git log` lists them. */
  readonly commits: readonly ReleaseCommit[]
  /** The previous release tag, or null for the first release. */
  readonly previousTag: string | null
}

/**
 * CHANGELOG.md as the release PR for `version` writes it: a new `## [version] - date` entry right
 * under `## [Unreleased]`. A Stable entry starts with the Unreleased notes and empties that
 * section; a prerelease leaves them for the next Stable release. A new major version needs
 * hand-written notes. Deterministic, so the workflow can regenerate it to verify a release PR.
 */
export function prepareChangelog(input: PrepareChangelogInput) {
  const { version, date } = input
  if (!DATE_PATTERN.test(date)) throw new Error(`Invalid changelog date: ${date}.`)
  if (entryHeadingIndex(lines(input.changelog), version) >= 0) {
    throw new Error(`${CHANGELOG_PATH} already has an entry for ${version}.`)
  }
  const { preamble, unreleased, released } = splitAtUnreleased(input.changelog)
  const stable = isStableAppVersion(version)
  const handWritten = stable ? unreleased : ''
  const problems = reservedHeadingProblems(handWritten)
  if (problems.length > 0) throw new Error(problems.join('\n'))
  if (MAJOR_VERSION_PATTERN.test(version) && handWritten === '') {
    throw new Error(majorNotesMessage(version))
  }
  const generated = generatedReleaseNotes(input.commits)
  const fallback = input.previousTag
    ? `No feature, fix or performance changes since ${input.previousTag}.`
    : 'The first release.'
  const entry = [handWritten, generated].filter((part) => part !== '').join('\n\n') || fallback
  return `${[
    preamble,
    UNRELEASED_HEADING,
    stable ? '' : unreleased,
    `## [${version}] - ${date}`,
    entry,
    released,
  ]
    .filter((part) => part !== '')
    .join('\n\n')}\n`
}

function majorNotesMessage(version: string) {
  return `Stable ${version} is a new major version: write its upgrade notes under "${UNRELEASED_HEADING}" in ${CHANGELOG_PATH} on main first.`
}

function readChangelog() {
  return fs.existsSync(CHANGELOG_PATH) ? fs.readFileSync(CHANGELOG_PATH, 'utf8') : ''
}

/**
 * Whether the release PR for `version` can be written from main's CHANGELOG.md, or, on the merged
 * release commit, was. Only a new major version waits for anything: its hand-written upgrade notes.
 */
function checkReleaseNotes(version: string) {
  const changelog = readChangelog()
  if (changelogEntry(changelog, version) !== null) return
  const notes = unreleasedNotes(changelog)
  const problems = isStableAppVersion(version) ? reservedHeadingProblems(notes) : []
  if (problems.length > 0) throw new Error(problems.join('\n'))
  if (MAJOR_VERSION_PATTERN.test(version) && notes === '') {
    throw new Error(majorNotesMessage(version))
  }
}

function requiredEntry(version: string) {
  const entry = changelogEntry(readChangelog(), version)
  if (!entry) {
    throw new Error(`${CHANGELOG_PATH} has no "## [${version}]" entry for its release notes.`)
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
  if (command === 'check') {
    checkReleaseNotes(version)
    process.stdout.write(`${CHANGELOG_PATH} can provide the release notes for ${version}.\n`)
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
