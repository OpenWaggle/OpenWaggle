import type {
  DocsDiscoveryView,
  ExtensionDocsTopicSummary,
  FirstPartyDocsTopicSummary,
} from '@shared/types/docs'

export type OpenWaggleDocsToolSource = 'openwaggle' | 'pi' | 'extension'

/** Where an extension topic came from, and what its file must still match to be read. */
export interface OpenWaggleDocsToolExtension {
  readonly id: string
  readonly name: string | null
  readonly packagePath: string
  /** The sha256 discovery computed after confirming the file is inside the package. */
  readonly contentHash: string
}

/** A first-party or extension docs topic, flattened to what the `openwaggle_docs` tool needs. */
export interface OpenWaggleDocsToolTopic {
  readonly topic: string
  readonly source: OpenWaggleDocsToolSource
  readonly title: string
  readonly description?: string
  readonly section?: string
  readonly path: string
  readonly aliases: readonly string[]
  readonly keywords: readonly string[]
  readonly rank: number
  readonly extension?: OpenWaggleDocsToolExtension
}

/** OpenWaggle topics before Pi topics, and both before extension topics. */
const SOURCE_RANK: Readonly<Record<OpenWaggleDocsToolSource, number>> = {
  openwaggle: 0,
  pi: 1,
  extension: 2,
}

const TITLE_TOKEN_SCORE = 5
const ALIAS_TOKEN_SCORE = 4
const TOPIC_TOKEN_SCORE = 3
const KEYWORD_TOKEN_SCORE = 3
const SECTION_TOKEN_SCORE = 2
const DESCRIPTION_TOKEN_SCORE = 1
const MIN_TOKEN_LENGTH = 2

/** Question words that would otherwise match nearly every topic's generated keywords. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'do',
  'does',
  'for',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'openwaggle',
  'or',
  'the',
  'to',
  'what',
  'when',
  'where',
  'why',
  'with',
])

function firstPartyTopic(topic: FirstPartyDocsTopicSummary): OpenWaggleDocsToolTopic {
  return {
    topic: topic.topic,
    source: topic.source,
    title: topic.title,
    ...(topic.description !== undefined ? { description: topic.description } : {}),
    ...(topic.section !== undefined ? { section: topic.section } : {}),
    path: topic.path,
    aliases: topic.aliases,
    keywords: topic.keywords,
    rank: topic.order,
  }
}

/**
 * Only docs of extensions the user trusted and enabled reach the agent, and only files discovery
 * hashed after confirming they stay inside the package. Docs of an extension that merely sits in a
 * cloned repository are third-party text the user never approved.
 */
function extensionTopic(
  topic: ExtensionDocsTopicSummary,
  rank: number,
): OpenWaggleDocsToolTopic | null {
  const { provenance } = topic
  if (provenance.trust !== 'trusted' || provenance.lifecycle !== 'enabled') return null
  if (topic.contentHash === null) return null
  return {
    topic: topic.topic,
    source: 'extension',
    title: topic.title,
    ...(topic.description !== undefined ? { description: topic.description } : {}),
    path: topic.path,
    aliases: topic.aliases,
    keywords: topic.keywords,
    rank,
    extension: {
      id: provenance.extensionId,
      name: provenance.extensionName,
      packagePath: provenance.packagePath,
      contentHash: topic.contentHash,
    },
  }
}

export function docsToolTopics(view: DocsDiscoveryView): readonly OpenWaggleDocsToolTopic[] {
  return [
    ...view.firstPartyTopics.map(firstPartyTopic),
    ...view.extensionTopics.flatMap((topic, index) => extensionTopic(topic, index) ?? []),
  ]
}

function compareTopics(left: OpenWaggleDocsToolTopic, right: OpenWaggleDocsToolTopic) {
  return (
    SOURCE_RANK[left.source] - SOURCE_RANK[right.source] ||
    left.rank - right.rank ||
    left.topic.localeCompare(right.topic)
  )
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

/** `openwaggle:using-openwaggle/hives-and-sessions` is also found as `using-openwaggle/hives-and-sessions`. */
function unprefixedTopic(topic: string) {
  const separator = topic.indexOf(':')
  return separator === -1 ? topic : topic.slice(separator + 1)
}

function queryTokens(query: string) {
  const tokens = normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)
  const meaningful = tokens.filter((token) => !STOP_WORDS.has(token))
  // A query of stop words alone, such as "openwaggle", still searches for them.
  return meaningful.length > 0 ? meaningful : tokens
}

function tokenScore(topic: OpenWaggleDocsToolTopic, token: string) {
  const includes = (value: string | undefined) => value?.toLowerCase().includes(token) === true
  let score = 0
  if (includes(topic.title)) score += TITLE_TOKEN_SCORE
  if (topic.aliases.some(includes)) score += ALIAS_TOKEN_SCORE
  if (includes(topic.topic)) score += TOPIC_TOKEN_SCORE
  if (topic.keywords.some((keyword) => keyword.toLowerCase() === token)) {
    score += KEYWORD_TOKEN_SCORE
  }
  if (includes(topic.section)) score += SECTION_TOKEN_SCORE
  if (includes(topic.description)) score += DESCRIPTION_TOKEN_SCORE
  return score
}

function isExactName(topic: OpenWaggleDocsToolTopic, query: string) {
  return (
    normalize(unprefixedTopic(topic.topic)) === query ||
    normalize(topic.title) === query ||
    topic.aliases.some((alias) => normalize(alias) === query)
  )
}

interface ScoredTopic {
  readonly topic: OpenWaggleDocsToolTopic
  /** The query is the topic's full id, such as `pi:settings`. */
  readonly exactId: boolean
  /** The query is the topic's unprefixed id, title, or an alias. */
  readonly exactName: boolean
  readonly score: number
}

/**
 * A full topic id first. Otherwise OpenWaggle topics come before Pi topics, and both before
 * extension topics, so a question about OpenWaggle settings reaches OpenWaggle's settings page
 * before Pi's; within a source, exact names first, then the best word matches.
 */
function compareScored(left: ScoredTopic, right: ScoredTopic) {
  if (left.exactId !== right.exactId) return left.exactId ? -1 : 1
  const bySource = SOURCE_RANK[left.topic.source] - SOURCE_RANK[right.topic.source]
  if (bySource !== 0) return bySource
  if (left.exactName !== right.exactName) return left.exactName ? -1 : 1
  return right.score - left.score || compareTopics(left.topic, right.topic)
}

function scoreTopics(
  topics: readonly OpenWaggleDocsToolTopic[],
  query: string,
  tokens: readonly string[],
  requireEveryToken: boolean,
) {
  return topics.flatMap((topic): ScoredTopic[] => {
    const exactId = normalize(topic.topic) === query
    const exactName = isExactName(topic, query)
    const tokenScores = tokens.map((token) => tokenScore(topic, token))
    const matches = requireEveryToken
      ? tokenScores.length > 0 && tokenScores.every((value) => value > 0)
      : tokenScores.some((value) => value > 0)
    const score = matches ? tokenScores.reduce((sum, value) => sum + value, 0) : 0
    return exactId || exactName || score > 0 ? [{ topic, exactId, exactName, score }] : []
  })
}

/** Topics that match `query`, best first, preferring topics that match every word. */
export function searchDocsToolTopics(
  topics: readonly OpenWaggleDocsToolTopic[],
  query: string,
  limit: number,
) {
  const normalizedQuery = normalize(query)
  const tokens = queryTokens(query)
  const everyToken = scoreTopics(topics, normalizedQuery, tokens, true)
  // Without a topic matching every word, fall back to topics matching any of them.
  const ranked =
    everyToken.length > 0 ? everyToken : scoreTopics(topics, normalizedQuery, tokens, false)
  return [...ranked]
    .sort(compareScored)
    .slice(0, limit)
    .map((entry) => entry.topic)
}

/**
 * The topic `reference` names: its exact topic id, the id without its `openwaggle:` or `pi:`
 * prefix, or an alias. Ambiguous references prefer OpenWaggle topics and report the others.
 */
export function resolveDocsToolTopic(
  topics: readonly OpenWaggleDocsToolTopic[],
  reference: string,
) {
  const normalized = normalize(reference)
  const exact = topics.find((topic) => normalize(topic.topic) === normalized)
  if (exact) return { topic: exact, alternatives: [] }
  const candidates = topics
    .filter(
      (topic) =>
        normalize(unprefixedTopic(topic.topic)) === normalized ||
        topic.aliases.some((alias) => normalize(alias) === normalized),
    )
    .sort(compareTopics)
  const [first, ...rest] = candidates
  return first ? { topic: first, alternatives: rest.map((topic) => topic.topic) } : null
}

const RELATED_TOPIC_LIMIT = 3

/**
 * OpenWaggle topics on the subject `reference` names when it resolved to a Pi or extension topic
 * without its full id, so `read settings` on Pi's settings page still points at OpenWaggle's.
 */
export function relatedOpenWaggleTopics(
  topics: readonly OpenWaggleDocsToolTopic[],
  reference: string,
  resolved: OpenWaggleDocsToolTopic,
) {
  if (resolved.source === 'openwaggle' || normalize(resolved.topic) === normalize(reference)) {
    return []
  }
  const openWaggleTopics = topics.filter((topic) => topic.source === 'openwaggle')
  return searchDocsToolTopics(openWaggleTopics, reference, RELATED_TOPIC_LIMIT).map(
    (topic) => topic.topic,
  )
}

export function sortDocsToolTopics(topics: readonly OpenWaggleDocsToolTopic[]) {
  return [...topics].sort(compareTopics)
}
