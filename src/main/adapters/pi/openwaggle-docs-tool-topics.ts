import type {
  DocsDiscoveryView,
  ExtensionDocsTopicSummary,
  FirstPartyDocsTopicSummary,
} from '@shared/types/docs'

export type OpenWaggleDocsToolSource = 'openwaggle' | 'pi' | 'extension'

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
  readonly extension?: {
    readonly id: string
    readonly name: string | null
    readonly trust: string
    readonly lifecycle: string
  }
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

function extensionTopic(topic: ExtensionDocsTopicSummary, rank: number): OpenWaggleDocsToolTopic {
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
      id: topic.provenance.extensionId,
      name: topic.provenance.extensionName,
      trust: topic.provenance.trust,
      lifecycle: topic.provenance.lifecycle,
    },
  }
}

export function docsToolTopics(view: DocsDiscoveryView): readonly OpenWaggleDocsToolTopic[] {
  return [
    ...view.firstPartyTopics.map(firstPartyTopic),
    ...view.extensionTopics.map((topic, index) => extensionTopic(topic, index)),
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
  return normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token))
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

function isExactMatch(topic: OpenWaggleDocsToolTopic, query: string) {
  return (
    normalize(topic.topic) === query ||
    normalize(unprefixedTopic(topic.topic)) === query ||
    normalize(topic.title) === query ||
    topic.aliases.some((alias) => normalize(alias) === query)
  )
}

interface ScoredTopic {
  readonly topic: OpenWaggleDocsToolTopic
  readonly exact: boolean
  readonly score: number
}

/** Exact names first, OpenWaggle before Pi among them; then the best word matches. */
function compareScored(left: ScoredTopic, right: ScoredTopic) {
  if (left.exact !== right.exact) return left.exact ? -1 : 1
  if (left.exact) return compareTopics(left.topic, right.topic)
  return right.score - left.score || compareTopics(left.topic, right.topic)
}

function scoreTopics(
  topics: readonly OpenWaggleDocsToolTopic[],
  query: string,
  tokens: readonly string[],
  requireEveryToken: boolean,
) {
  return topics.flatMap((topic): ScoredTopic[] => {
    const exact = isExactMatch(topic, query)
    const tokenScores = tokens.map((token) => tokenScore(topic, token))
    const matches = requireEveryToken
      ? tokenScores.length > 0 && tokenScores.every((value) => value > 0)
      : tokenScores.some((value) => value > 0)
    const score = matches ? tokenScores.reduce((sum, value) => sum + value, 0) : 0
    return exact || score > 0 ? [{ topic, exact, score }] : []
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

export function sortDocsToolTopics(topics: readonly OpenWaggleDocsToolTopic[]) {
  return [...topics].sort(compareTopics)
}
