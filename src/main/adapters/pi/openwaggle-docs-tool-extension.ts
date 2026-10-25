import { match } from '@diegogbrisa/ts-match'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { OPENWAGGLE_DOCS_TOOL_NAME } from '@shared/constants/openwaggle-docs'
import type { DocsDiscoveryView, DocsListInput } from '@shared/types/docs'
import * as Effect from 'effect/Effect'
import { type Static, type TSchema, Type } from 'typebox'
import { Check, Errors } from 'typebox/value'
import { createLogger } from '../../logger'
import { docsReadText, docsReadWindow, readDocsToolTopicFile } from './openwaggle-docs-tool-read'
import {
  docsToolTopics,
  type OpenWaggleDocsToolTopic,
  relatedOpenWaggleTopics,
  resolveDocsToolTopic,
  searchDocsToolTopics,
  sortDocsToolTopics,
} from './openwaggle-docs-tool-topics'

const logger = createLogger('openwaggle-docs-tool')

const BUNDLE_README = 'README.md'
const BUNDLE_INDEX = 'index.json'
const MAX_QUERY_LENGTH = 500
const MAX_TOPIC_LENGTH = 500
const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 50

/** The Host services the tool reads docs through: the installed bundle plus extension docs. */
export interface OpenWaggleDocsToolServices {
  /** Where the installed bundle is expected, whether or not it is there. */
  readonly bundlePath: () => Effect.Effect<string>
  /** The bundle root when its index loads, or null when the bundle is missing or broken. */
  readonly availableBundlePath: () => Effect.Effect<string | null>
  readonly discover: (input: DocsListInput) => Effect.Effect<DocsDiscoveryView, unknown>
}

interface OpenWaggleDocsToolInput {
  readonly services: OpenWaggleDocsToolServices
  /** The Session's project, whose project-scoped extension docs are included. */
  readonly projectPath: string
  /** `availableBundlePath()` resolved for this Run, named in the prompt guidelines. */
  readonly bundlePath: string | null
}

const source = Type.Union(
  [Type.Literal('openwaggle'), Type.Literal('pi'), Type.Literal('extension')],
  {
    description:
      'Only topics from this source: "openwaggle" (the OpenWaggle app), "pi" (the Pi runtime OpenWaggle runs on), or "extension" (installed OpenWaggle extensions).',
  },
)
const query = Type.String({
  minLength: 1,
  maxLength: MAX_QUERY_LENGTH,
  description: 'Words to look for in topic titles, aliases, keywords, and descriptions.',
})
const limit = Type.Integer({ minimum: 1, maximum: MAX_SEARCH_LIMIT })
const topic = Type.String({
  minLength: 1,
  maxLength: MAX_TOPIC_LENGTH,
  description:
    'A topic id from list or search, such as "openwaggle:using-openwaggle/hives-and-sessions", the id without its prefix, or an alias.',
})
const offset = Type.Integer({
  minimum: 1,
  description: 'First line to return, 1-based. Use the nextOffset of a truncated read.',
})
const parameterVariants = [
  Type.Object({ action: Type.Literal('list'), source: Type.Optional(source) }),
  Type.Object({
    action: Type.Literal('search'),
    query,
    source: Type.Optional(source),
    limit: Type.Optional(limit),
  }),
  Type.Object({ action: Type.Literal('read'), topic, offset: Type.Optional(offset) }),
] as const
type OpenWaggleDocsToolParameters = Static<(typeof parameterVariants)[number]>

// Flat at the root: providers that emit `{}` for a root-level anyOf get one object, and each
// action's required fields are checked before it runs.
const parameters = Type.Unsafe<OpenWaggleDocsToolParameters>({
  type: 'object',
  properties: {
    action: Type.Union(
      parameterVariants.map((variant) => variant.properties.action),
      {
        description:
          '"list" shows every topic, "search" finds topics for a question, "read" returns one topic\'s Markdown.',
      },
    ),
    source: Type.Optional(source),
    query: Type.Optional(query),
    limit: Type.Optional(limit),
    topic: Type.Optional(topic),
    offset: Type.Optional(offset),
  },
  required: ['action'],
})

function validationDetails(schema: TSchema, value: unknown) {
  return [...Errors(schema, value)]
    .map((error) => `${error.instancePath || 'arguments'}: ${error.message}`)
    .join('; ')
}

function assertDocsToolArguments(params: unknown): asserts params is OpenWaggleDocsToolParameters {
  if (!Check(parameters, params)) {
    throw new Error(
      `Invalid ${OPENWAGGLE_DOCS_TOOL_NAME} arguments: ${validationDetails(parameters, params)}`,
    )
  }
  const action = params.action
  const variant = parameterVariants.find(
    (candidate) => candidate.properties.action.const === action,
  )
  if (variant === undefined) {
    throw new Error(`Unknown ${OPENWAGGLE_DOCS_TOOL_NAME} action "${action}".`)
  }
  if (Check(variant, params)) return
  throw new Error(
    `Invalid ${OPENWAGGLE_DOCS_TOOL_NAME} arguments for "${action}": ${validationDetails(variant, params)}`,
  )
}

function topicSummary(entry: OpenWaggleDocsToolTopic) {
  return {
    topic: entry.topic,
    title: entry.title,
    ...(entry.section !== undefined ? { section: entry.section } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.extension
      ? { extension: { id: entry.extension.id, name: entry.extension.name } }
      : {}),
  }
}

/** One action's result: the text the model reads, and the structured details kept with it. */
interface DocsToolOutput {
  readonly text: string
  readonly details: unknown
}

function jsonOutput(details: unknown): DocsToolOutput {
  return { text: JSON.stringify(details), details }
}

function filterSource(
  topics: readonly OpenWaggleDocsToolTopic[],
  wanted: OpenWaggleDocsToolTopic['source'] | undefined,
) {
  return wanted ? topics.filter((entry) => entry.source === wanted) : topics
}

async function discover(input: OpenWaggleDocsToolInput, includeExtensions: boolean) {
  try {
    return await Effect.runPromise(
      input.services.discover({ projectPaths: [input.projectPath], includeExtensions }),
    )
  } catch (error) {
    const expected = await Effect.runPromise(input.services.bundlePath())
    logger.warn('OpenWaggle docs could not be loaded for an agent', {
      bundlePath: expected,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `The OpenWaggle docs bundle could not be loaded from ${JSON.stringify(expected)}. In a development checkout, run \`pnpm docs:generate\` to build it; in an installed app, reinstall OpenWaggle. Answer from what you already know and say the docs were unavailable.`,
      { cause: error },
    )
  }
}

async function listTopics(
  input: OpenWaggleDocsToolInput,
  wanted: OpenWaggleDocsToolTopic['source'] | undefined,
) {
  const view = await discover(input, wanted === undefined || wanted === 'extension')
  const topics = sortDocsToolTopics(filterSource(docsToolTopics(view), wanted))
  return jsonOutput({
    bundlePath: view.bundlePath,
    generatedAt: view.generatedAt,
    topics: topics.map(topicSummary),
    ...(view.diagnostics.length > 0 ? { diagnostics: view.diagnostics } : {}),
  })
}

async function searchTopics(
  input: OpenWaggleDocsToolInput,
  params: Extract<OpenWaggleDocsToolParameters, { action: 'search' }>,
) {
  const view = await discover(input, params.source === undefined || params.source === 'extension')
  const topics = filterSource(docsToolTopics(view), params.source)
  const results = searchDocsToolTopics(topics, params.query, params.limit ?? DEFAULT_SEARCH_LIMIT)
  return jsonOutput({
    query: params.query,
    results: results.map(topicSummary),
    ...(results.length === 0
      ? { hint: 'No topic matched. Try fewer or different words, or use list to see every topic.' }
      : {}),
  })
}

async function readTopic(
  input: OpenWaggleDocsToolInput,
  params: Extract<OpenWaggleDocsToolParameters, { action: 'read' }>,
) {
  const view = await discover(input, true)
  const topics = docsToolTopics(view)
  const resolved = resolveDocsToolTopic(topics, params.topic)
  if (!resolved) {
    throw new Error(
      `No OpenWaggle docs topic is named ${JSON.stringify(params.topic)}. Use search or list to find its id.`,
    )
  }
  const entry = resolved.topic
  const window = docsReadWindow(await readDocsToolTopicFile(entry), params.offset ?? 1)
  const { content: _content, ...lines } = window
  const related = relatedOpenWaggleTopics(topics, params.topic, entry)
  return {
    text: docsReadText({ entry, window, alternatives: resolved.alternatives, related }),
    details: {
      ...topicSummary(entry),
      source: entry.source,
      path: entry.path,
      ...(resolved.alternatives.length > 0 ? { otherMatches: resolved.alternatives } : {}),
      ...(related.length > 0 ? { relatedOpenWaggleTopics: related } : {}),
      ...lines,
    },
  }
}

function execute(input: OpenWaggleDocsToolInput, params: unknown): Promise<DocsToolOutput> {
  assertDocsToolArguments(params)
  return match(params)
    .with({ action: 'list' }, (list) => listTopics(input, list.source))
    .with({ action: 'search' }, (search) => searchTopics(input, search))
    .with({ action: 'read' }, (read) => readTopic(input, read))
    .exhaustive()
}

/** The rules this tool adds to the system prompt; the bundle root is named only when it loads. */
export function openWaggleDocsPromptGuidelines(bundlePath: string | null) {
  return [
    `For questions about OpenWaggle itself (Hives and Worker Sessions, Waggle mode, settings, providers, MCP, extensions, skills, project actions, browser preview, worktrees, the hive CLI), use ${OPENWAGGLE_DOCS_TOOL_NAME} search or list, then read the topic, instead of guessing from memory or file paths.`,
    ...(bundlePath
      ? [
          `The installed OpenWaggle docs bundle is ${JSON.stringify(bundlePath)}: ${BUNDLE_README} and ${BUNDLE_INDEX} at its root, Markdown under topics/. Its topics/pi/ holds the Pi docs as plain files: paths inside app.asar open with the read and ls tools, not from shell commands, find, or grep.`,
        ]
      : []),
  ]
}

export function createOpenWaggleDocsToolExtension(
  input: OpenWaggleDocsToolInput,
): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: OPENWAGGLE_DOCS_TOOL_NAME,
      label: 'OpenWaggle Docs',
      description:
        'Look up the OpenWaggle documentation installed with this app: OpenWaggle product docs, the Pi runtime docs, and docs of the OpenWaggle extensions this Session loads (written by each extension\'s author). "list" returns every topic id with its title and description, "search" ranks topics for a question, OpenWaggle topics first, and "read" returns one topic\'s Markdown, paged like the read tool. Topic ids look like "openwaggle:using-openwaggle/hives-and-sessions" or "pi:extensions".',
      promptSnippet:
        'Look up OpenWaggle and Pi documentation by topic when asked how OpenWaggle works.',
      promptGuidelines: openWaggleDocsPromptGuidelines(input.bundlePath),
      parameters,
      executionMode: 'parallel',
      async execute(_toolCallId, params, signal) {
        try {
          signal?.throwIfAborted()
          const result = await execute(input, params)
          return { content: [{ type: 'text', text: result.text }], details: result.details }
        } catch (error) {
          return {
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
            details: null,
            isError: true,
          }
        }
      },
    })
  }
}
