import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The repository's development fixture extension (`fixtures/extensions/`). */
const FIXTURE_EXTENSION_ID = 'openwaggle-github-issues-overview'
export const FIXTURE_EXTENSION_NAME = 'GitHub Issues Overview'
/**
 * A made-up repository the capture saves in the extension's settings, so the images never show a
 * real repository or issue numbers of OpenWaggle's own (the fixture's default is OpenWaggle's
 * repository, for live QA).
 */
export const FIXTURE_REPOSITORY = { owner: 'acme', repo: 'desktop-agent' } as const
/** Every request the fixture makes; the capture answers them with `githubIssuesFixture`. */
export const GITHUB_API_URL_PATTERN = 'https://api.github.com/**'

const DAY_MS = 86_400_000
/** Every issue was updated at this time of day (UTC), so re-runs on one day give the same dates. */
const ISSUE_UPDATE_TIME_OF_DAY_MS = 9 * 3_600_000
/** Kept out of Git status, so the header's change count stays the README edit. */
const PROJECT_EXCLUDE_ENTRY = '.openwaggle/'

function packageDirectory(projectPath: string) {
  return path.join(projectPath, ...OPENWAGGLE_EXTENSION.PROJECT_ROOT_SEGMENTS, FIXTURE_EXTENSION_ID)
}

async function excludeFromGitStatus(projectPath: string) {
  const excludePath = path.join(projectPath, '.git', 'info', 'exclude')
  const current = await fs.readFile(excludePath, 'utf8').catch(() => '')
  if (current.split('\n').includes(PROJECT_EXCLUDE_ENTRY)) return
  await fs.mkdir(path.dirname(excludePath), { recursive: true })
  await fs.appendFile(excludePath, `\n${PROJECT_EXCLUDE_ENTRY}\n`, 'utf8')
}

/** Copies the fixture package into the project, like `pnpm extension:qa:install` for a checkout. */
export async function installFixtureExtension(projectPath: string) {
  await excludeFromGitStatus(projectPath)
  const target = packageDirectory(projectPath)
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.cp(path.join(ROOT_DIR, 'fixtures', 'extensions', FIXTURE_EXTENSION_ID), target, {
    recursive: true,
  })
}

export async function deleteFixtureExtension(projectPath: string) {
  await fs.rm(packageDirectory(projectPath), { recursive: true, force: true })
}

interface FixtureIssue {
  readonly number: number
  readonly title: string
  readonly labels: readonly string[]
  readonly updatedDaysAgo: number
}

/** Six open issues: three `ready-for-agent`, one older than the fixture's 30-day stale limit. */
const FIXTURE_ISSUES: readonly FixtureIssue[] = [
  {
    number: 2184,
    title: 'Remember the last Settings section per window',
    labels: ['enhancement', 'ready-for-agent'],
    updatedDaysAgo: 1,
  },
  {
    number: 2179,
    title: 'Show the worker count in the Hive tab badge',
    labels: ['enhancement', 'ready-for-agent'],
    updatedDaysAgo: 2,
  },
  {
    number: 2173,
    title: 'Terminal: keep scrollback when a split is closed',
    labels: ['bug'],
    updatedDaysAgo: 3,
  },
  {
    number: 2166,
    title: 'Docs: add screenshots to the extension guide',
    labels: ['documentation', 'ready-for-agent'],
    updatedDaysAgo: 5,
  },
  {
    number: 2158,
    title: 'Composer: paste images from the clipboard on Linux',
    labels: ['bug', 'needs-info'],
    updatedDaysAgo: 9,
  },
  {
    number: 2131,
    title: 'Browser preview: export a HAR file from the network log',
    labels: ['enhancement'],
    updatedDaysAgo: 41,
  },
]

/** The fixture's issues in the shape of GitHub's REST `GET /repos/{owner}/{repo}/issues`. */
export function githubIssuesFixture(now: number) {
  const today = Math.floor(now / DAY_MS) * DAY_MS + ISSUE_UPDATE_TIME_OF_DAY_MS
  return FIXTURE_ISSUES.map((issue) => ({
    number: issue.number,
    title: issue.title,
    html_url: `https://github.com/${FIXTURE_REPOSITORY.owner}/${FIXTURE_REPOSITORY.repo}/issues/${String(issue.number)}`,
    updated_at: new Date(today - issue.updatedDaysAgo * DAY_MS).toISOString(),
    labels: issue.labels.map((name) => ({ name })),
  }))
}
