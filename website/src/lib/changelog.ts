import { releaseStageLabel } from './release-stage'
import { GITHUB_URL, SITE_NAME, SITE_URL } from './seo'

/**
 * Reads the repository's root CHANGELOG.md for the website's `/changelog/` page and its RSS feed.
 *
 * Entry headings are `## [1.0.0-beta.44] - 2026-11-18` (newest first), or the legacy `## 1.0.0`
 * with no brackets and no date. The preamble before the first entry and the `## [Unreleased]`
 * notes for the next release are never published. Any other `##` heading fails the build, so a
 * typo in a release PR cannot drop an entry from the page without anyone noticing.
 */

export const CHANGELOG_PATH = '/changelog/'
export const CHANGELOG_FEED_PATH = '/changelog/rss.xml'
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`

export interface ChangelogEntry {
  readonly version: string
  /** `YYYY-MM-DD`, absent on a legacy heading. */
  readonly date?: string
  /** The entry's Markdown, without its heading. */
  readonly body: string
}

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`
const ISO_DATE = String.raw`\d{4}-\d{2}-\d{2}`
// `## [1.0.0] - 2026-12-01`, optionally with a compare link after the brackets; `## 1.0.0`.
const ENTRY_HEADING = new RegExp(
  `^##[ \\t]+(?:\\[(?<bracketed>${SEMVER})\\](?:\\([^)\\s]*\\))?|(?<legacy>${SEMVER}))` +
    `(?:[ \\t]+[-–][ \\t]+(?<date>${ISO_DATE}))?[ \\t]*$`,
  'u',
)
const UNRELEASED_HEADING = /^##[ \t]+\[?unreleased\]?[ \t]*$/iu
const LEVEL_TWO_HEADING = /^##[ \t]/u
const FENCE = /^[ \t]{0,3}(?<marker>`{3,}|~{3,})/u
const LINE_BREAK = /\r?\n/u
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length

interface OpenEntry {
  readonly version: string
  readonly date?: string
  readonly lines: string[]
}

function assertCalendarDate(date: string, heading: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, ISO_DATE_LENGTH) !== date) {
    throw new Error(`CHANGELOG.md heading "${heading}" has an invalid date "${date}"`)
  }
}

function openEntry(heading: string) {
  const match = ENTRY_HEADING.exec(heading)
  const version = match?.groups?.bracketed ?? match?.groups?.legacy
  if (version === undefined) {
    throw new Error(
      `CHANGELOG.md heading "${heading}" is neither "## [Unreleased]" nor "## [X.Y.Z] - YYYY-MM-DD"`,
    )
  }
  // Fails on a stage the site has no label for, the same way the landing page badge does.
  releaseStageLabel(version)
  const date = match?.groups?.date
  if (date !== undefined) assertCalendarDate(date, heading)
  const entry: OpenEntry =
    date === undefined ? { version, lines: [] } : { version, date, lines: [] }
  return entry
}

function closeEntry(entry: OpenEntry) {
  const body = entry.lines.join('\n').trim()
  const closed: ChangelogEntry =
    entry.date === undefined
      ? { version: entry.version, body }
      : { version: entry.version, date: entry.date, body }
  return closed
}

/** The released entries of a CHANGELOG.md, in file order (newest first). */
export function parseChangelog(source: string) {
  const entries: ChangelogEntry[] = []
  const seen = new Set<string>()
  // `undefined` in the preamble, `null` inside the Unreleased section, otherwise the open entry.
  let current: OpenEntry | null | undefined
  let fence: string | undefined

  const finish = () => {
    if (!current) return
    if (seen.has(current.version)) {
      throw new Error(`CHANGELOG.md lists ${current.version} twice`)
    }
    seen.add(current.version)
    entries.push(closeEntry(current))
  }

  for (const line of source.split(LINE_BREAK)) {
    const marker = FENCE.exec(line)?.groups?.marker
    // A `##` line inside a fenced code block is code, not an entry heading.
    const togglesFence = marker !== undefined && (fence === undefined || marker.startsWith(fence))
    if (togglesFence) fence = fence === undefined ? marker : undefined
    if (!togglesFence && fence === undefined && LEVEL_TWO_HEADING.test(line)) {
      finish()
      current = UNRELEASED_HEADING.test(line) ? null : openEntry(line.trim())
      continue
    }
    current?.lines.push(line)
  }
  finish()
  return entries
}

/** The entry's anchor on the changelog page, e.g. `v1-0-0-beta-44` for `1.0.0-beta.44`. */
export function changelogAnchor(version: string) {
  return `v${version.toLowerCase().replaceAll(/[^0-9a-z]+/gu, '-')}`
}

export function githubReleaseUrl(version: string) {
  return `${GITHUB_RELEASES_URL}/tag/v${version}`
}

const HUMAN_DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })

/** `2026-11-18` as `November 18, 2026`. */
export function formatChangelogDate(date: string) {
  return HUMAN_DATE.format(new Date(`${date}T00:00:00Z`))
}

const HEADING_ID = /(<h[1-6]\b[^>]*?\sid=")([^"]+)(")/gu

/**
 * Prefixes the ids of the headings rendered from one entry, so the `### Features` of every
 * release does not become the same `id="features"` on one page.
 */
export function scopeHeadingIds(html: string, anchor: string) {
  return html.replaceAll(
    HEADING_ID,
    (_match, before: string, id: string, after: string) => `${before}${anchor}-${id}${after}`,
  )
}

export interface ChangelogFeedItem {
  readonly version: string
  readonly date?: string
  /** The entry rendered to HTML. */
  readonly html: string
}

const XML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&apos;'],
])

function escapeXml(text: string) {
  return text.replaceAll(/[&<>"']/gu, (character) => XML_ESCAPES.get(character) ?? character)
}

/** Wraps HTML in CDATA, splitting any `]]>` it contains so it cannot close the section early. */
function cdata(html: string) {
  return `<![CDATA[${html.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
}

// Feed readers resolve links against the feed, not the page, so site-relative URLs become absolute.
function absoluteUrls(html: string) {
  return html.replaceAll(/(\s(?:href|src)=")\/(?!\/)/gu, `$1${SITE_URL}/`)
}

function rfc822Date(date: string) {
  return new Date(`${date}T00:00:00Z`).toUTCString()
}

function feedItem(item: ChangelogFeedItem) {
  const link = `${SITE_URL}${CHANGELOG_PATH}#${changelogAnchor(item.version)}`
  return [
    '    <item>',
    `      <title>${escapeXml(`${SITE_NAME} ${item.version}`)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    ...(item.date === undefined ? [] : [`      <pubDate>${rfc822Date(item.date)}</pubDate>`]),
    `      <description>${cdata(absoluteUrls(item.html))}</description>`,
    '    </item>',
  ].join('\n')
}

/** The RSS 2.0 feed of the changelog, newest entry first. */
export function buildChangelogFeed(input: {
  readonly description: string
  readonly items: readonly ChangelogFeedItem[]
}) {
  const pageUrl = `${SITE_URL}${CHANGELOG_PATH}`
  // The newest dated entry, not the build time, so an unchanged changelog builds the same feed.
  const newestDate = input.items.find((item) => item.date !== undefined)?.date
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(`${SITE_NAME} changelog`)}</title>`,
    `    <link>${escapeXml(pageUrl)}</link>`,
    `    <description>${escapeXml(input.description)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${escapeXml(`${SITE_URL}${CHANGELOG_FEED_PATH}`)}" rel="self" type="application/rss+xml" />`,
    ...(newestDate === undefined
      ? []
      : [`    <lastBuildDate>${rfc822Date(newestDate)}</lastBuildDate>`]),
    ...input.items.map(feedItem),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
