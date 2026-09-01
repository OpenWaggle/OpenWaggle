import fs from 'node:fs'
import path from 'node:path'
import { Schema } from 'effect'
import { parse } from 'yaml'

const JSON_INDENT = 2
const FRONTMATTER_MATCH_GROUP = 1
const BODY_MATCH_GROUP = 2
const VERSION_MAJOR_GROUP = 1
const VERSION_MINOR_GROUP = 2
const VERSION_PATCH_GROUP = 3
const VERSION_STAGE_GROUP = 4
const VERSION_STAGE_NUMBER_GROUP = 5
const CHANGELOG_MARKER = '<!-- app-release-history -->'
const INTENT_FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/u

const IMPACTS = ['none', 'patch', 'minor', 'major'] as const
const AREAS = [
  'runtime',
  'sessions',
  'providers',
  'ui',
  'installer',
  'updater',
  'user-docs',
  'internal',
] as const
const AUDIENCES = ['users', 'prerelease-users', 'developers'] as const
const MILESTONES = ['v1', 'post-v1'] as const
const FRONTMATTER_KEYS = ['impact', 'area', 'audience', 'milestone'] as const

const releaseIntentMetadataSchema = Schema.Struct({
  impact: Schema.Literal(...IMPACTS),
  area: Schema.Literal(...AREAS),
  audience: Schema.Literal(...AUDIENCES),
  milestone: Schema.Literal(...MILESTONES),
})

export type AppReleaseArea = typeof AREAS[number]
export type AppReleaseImpact = typeof IMPACTS[number]
export type AppReleaseIntentMetadata = typeof releaseIntentMetadataSchema.Type

export interface AppReleaseIntent extends AppReleaseIntentMetadata {
  readonly body: string
  readonly file: string
}

export interface AppReleasePlan {
  readonly entries: readonly AppReleaseIntent[]
  readonly files: readonly string[]
  readonly impact: AppReleaseImpact | null
  readonly shouldRelease: boolean
  readonly version: string | null
}

function normalizeNewlines(value: string) {
  return value.replaceAll('\r\n', '\n')
}

function parseIntentMetadata(file: string, frontmatterSource: string) {
  let decodedYaml: unknown
  try {
    decodedYaml = parse(frontmatterSource)
  } catch (error: unknown) {
    throw new Error(`${file}: invalid YAML frontmatter.`, { cause: error })
  }
  if (typeof decodedYaml !== 'object' || decodedYaml === null || Array.isArray(decodedYaml)) {
    throw new Error(`${file}: frontmatter must be a mapping.`)
  }
  const keys = Object.keys(decodedYaml).sort()
  const expectedKeys = [...FRONTMATTER_KEYS].sort()
  if (keys.join('\n') !== expectedKeys.join('\n')) {
    throw new Error(
      `${file}: frontmatter must contain exactly ${FRONTMATTER_KEYS.join(', ')}.`,
    )
  }

  let metadata: AppReleaseIntentMetadata
  try {
    metadata = Schema.decodeUnknownSync(releaseIntentMetadataSchema)(decodedYaml)
  } catch (error: unknown) {
    throw new Error(
      `${file}: invalid release-intent metadata: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  if (metadata.area === 'internal' && metadata.audience !== 'developers') {
    throw new Error(`${file}: internal entries must target developers.`)
  }
  if (metadata.impact === 'none' && metadata.audience !== 'developers') {
    throw new Error(`${file}: impact none is reserved for developer audit entries.`)
  }

  return metadata
}

function parseIntentFile(file: string, contents: string): AppReleaseIntent {
  const normalized = normalizeNewlines(contents)
  if (!normalized.endsWith('\n')) {
    throw new Error(`${file}: release-intent files must end with a newline.`)
  }

  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(normalized)
  if (!match) {
    throw new Error(`${file}: expected YAML frontmatter delimited by exact --- lines.`)
  }

  const frontmatterSource = match[FRONTMATTER_MATCH_GROUP]
  const body = match[BODY_MATCH_GROUP]?.trim() ?? ''
  if (!frontmatterSource || !body) {
    throw new Error(`${file}: frontmatter and a human-facing note body are required.`)
  }

  return { ...parseIntentMetadata(file, frontmatterSource), body, file }
}

export function readAppReleaseIntents(projectRoot: string) {
  const changesDirectory = path.join(projectRoot, '.release', 'changes')
  if (!fs.existsSync(changesDirectory)) {
    return []
  }

  const entries = fs.readdirSync(changesDirectory, { withFileTypes: true })
  const invalidEntry = entries.find(
    (entry) => !entry.isFile() || !INTENT_FILE_PATTERN.test(entry.name),
  )
  if (invalidEntry) {
    throw new Error(
      `.release/changes/${invalidEntry.name}: expected a regular kebab-case Markdown file.`,
    )
  }

  return entries
    .map(({ name }) => name)
    .sort()
    .map((name) => {
      const file = `.release/changes/${name}`
      return parseIntentFile(file, fs.readFileSync(path.join(projectRoot, file), 'utf8'))
    })
}

function highestImpact(entries: readonly AppReleaseIntent[]) {
  let highestIndex = -1
  for (const entry of entries) {
    highestIndex = Math.max(highestIndex, IMPACTS.indexOf(entry.impact))
  }
  return highestIndex < 0 ? null : IMPACTS[highestIndex]
}

export function nextAppVersion(currentVersion: string, impact: AppReleaseImpact) {
  if (impact === 'none') return null
  const match = VERSION_PATTERN.exec(currentVersion)
  if (!match) {
    throw new Error(`Unsupported desktop app version: ${currentVersion}.`)
  }

  const major = Number(match[VERSION_MAJOR_GROUP])
  const minor = Number(match[VERSION_MINOR_GROUP])
  const patch = Number(match[VERSION_PATCH_GROUP])
  const stage = match[VERSION_STAGE_GROUP]
  const stageNumber = match[VERSION_STAGE_NUMBER_GROUP]
    ? Number(match[VERSION_STAGE_NUMBER_GROUP])
    : null
  if (stage && stageNumber !== null) {
    return `${major}.${minor}.${patch}-${stage}.${stageNumber + 1}`
  }
  if (impact === 'major') return `${major + 1}.0.0`
  if (impact === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export function createAppReleasePlan(
  currentVersion: string,
  entries: readonly AppReleaseIntent[],
): AppReleasePlan {
  const impact = highestImpact(entries)
  const version = impact ? nextAppVersion(currentVersion, impact) : null
  return {
    entries,
    files: entries.map(({ file }) => file),
    impact,
    shouldRelease: version !== null,
    version,
  }
}

function areaHeading(area: AppReleaseArea) {
  if (area === 'ui') return 'UI'
  if (area === 'user-docs') return 'User documentation'
  return `${area[0]?.toUpperCase() ?? ''}${area.slice(1)}`
}

function renderGroupedEntries(entries: readonly AppReleaseIntent[]) {
  const sections: string[] = []
  for (const area of AREAS) {
    const areaEntries = entries.filter((entry) => entry.area === area)
    if (areaEntries.length === 0) continue
    sections.push(
      `### ${areaHeading(area)}\n\n${areaEntries.map(({ body }) => body).join('\n\n')}`,
    )
  }
  return sections.join('\n\n')
}

export function renderAppReleaseNotes(
  version: string,
  entries: readonly AppReleaseIntent[],
) {
  const publicEntries = entries.filter(
    ({ area, audience }) => area !== 'internal' && audience !== 'developers',
  )
  const grouped = renderGroupedEntries(publicEntries)
  return `# OpenWaggle v${version}${grouped ? `\n\n${grouped}` : ''}\n`
}

export function updateAppChangelog(
  currentChangelog: string,
  version: string,
  date: string,
  entries: readonly AppReleaseIntent[],
) {
  if (!currentChangelog.includes(CHANGELOG_MARKER)) {
    throw new Error(`CHANGELOG.md is missing ${CHANGELOG_MARKER}.`)
  }
  const grouped = renderGroupedEntries(entries)
  if (!grouped) {
    throw new Error('A release must contain at least one changelog entry.')
  }
  const releaseSection = `## v${version} — ${date}\n\n${grouped}`
  return currentChangelog.replace(
    CHANGELOG_MARKER,
    `${CHANGELOG_MARKER}\n\n${releaseSection}`,
  )
}

export function readAppManifestVersion(projectRoot: string) {
  const packageJson = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  const manifest = Schema.decodeUnknownSync(
    Schema.parseJson(Schema.Struct({ version: Schema.String })),
  )(packageJson)
  return manifest.version
}

function writeManifestVersion(projectRoot: string, version: string) {
  const manifestPath = path.join(projectRoot, 'package.json')
  const manifest = Schema.decodeUnknownSync(
    Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  )(fs.readFileSync(manifestPath, 'utf8'))
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, version }, null, JSON_INDENT)}\n`,
  )
}

export function prepareAppRelease(projectRoot: string, version: string, date: string) {
  const entries = readAppReleaseIntents(projectRoot)
  const plan = createAppReleasePlan(readAppManifestVersion(projectRoot), entries)
  if (!plan.shouldRelease || plan.version !== version) {
    throw new Error(
      `Release plan resolves to ${plan.version ?? 'no release'}, not requested v${version}.`,
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error(`Invalid release date: ${date}.`)
  }

  writeManifestVersion(projectRoot, version)
  const changelogPath = path.join(projectRoot, 'CHANGELOG.md')
  fs.writeFileSync(
    changelogPath,
    updateAppChangelog(
      fs.readFileSync(changelogPath, 'utf8'),
      version,
      date,
      entries,
    ),
  )
  fs.writeFileSync(
    path.join(projectRoot, '.release', 'release-notes.md'),
    renderAppReleaseNotes(version, entries),
  )
  for (const { file } of entries) fs.unlinkSync(path.join(projectRoot, file))
  fs.rmdirSync(path.join(projectRoot, '.release', 'changes'))
}
