import { createHash } from 'node:crypto'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import type {
  AgentDefinitionDocument,
  AgentDefinitionScope,
  ResolvedAgentDefinitionSnapshot,
} from '@shared/types/agent-definition'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'
import { THINKING_LEVELS } from '@shared/types/settings'
import { formatParseError } from '@shared/schema'
import { Either, Schema } from 'effect'
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import {
  boundedArray,
  boundedString,
  check,
  enumeration,
  integer,
  literal,
  optional,
  patternString,
  trimmedString,
  uriString,
} from '../json-schema-primitives'
import { isAgentDefinitionName } from './agent-definition-name'

const MAX_DOCUMENT_BYTES = 128 * 1024
const MAX_INSTRUCTION_BYTES = 64 * 1024
const MAX_LIST_ITEMS = 128
const MAX_DESCRIPTION_CHARACTERS = 500
const MAX_MODEL_ID_CHARACTERS = 200

const agentName = Schema.String.pipe(
  check(isAgentDefinitionName, 'Invalid or non-portable Agent definition name'),
)
const description = trimmedString({ min: 1, max: MAX_DESCRIPTION_CHARACTERS })
const modelId = trimmedString({ min: 1, max: MAX_MODEL_ID_CHARACTERS })
const nameList = boundedArray(trimmedString({ min: 1 }), MAX_LIST_ITEMS)
const sha256Digest = patternString(/^[a-f0-9]{64}$/)
const nonEmptyString = boundedString({ min: 1 })

/** Agent definition v1 frontmatter. The published JSON Schema is checked against it in tests. */
export const agentDefinitionFrontmatterSchema = Schema.Struct({
  schemaVersion: literal(1),
  $schema: optional(uriString),
  name: agentName,
  description,
  model: optional(modelId),
  reasoning: optional(enumeration(...THINKING_LEVELS)),
  tools: optional(nameList),
  skills: optional(nameList),
  mcpServers: optional(nameList),
  sessionCapabilities: optional(
    boundedArray(enumeration(...SESSION_CAPABILITIES), SESSION_CAPABILITIES.length),
  ),
  authorizationMode: optional(enumeration(...AGENT_AUTHORIZATION_MODES)),
  workspace: optional(enumeration('share-parent', 'local', 'new-worktree')),
  import: optional(
    Schema.Struct({
      sourceTool: enumeration(
        'openwaggle',
        'codex',
        'claude-code',
        'cursor',
        'gemini-cli',
        'github-copilot',
        'opencode',
      ),
      sourcePath: nonEmptyString,
      sourceName: optional(nonEmptyString),
      sourceDigest: sha256Digest,
      importerVersion: literal(1),
      baselineDigest: sha256Digest,
      importedAt: integer({ min: 0 }),
    }),
  ),
})

const piFrontmatterSchema = Schema.Struct({
  name: agentName,
  description,
  model: Schema.optionalWith(modelId, { exact: true }),
  tools: Schema.optionalWith(Schema.Union(Schema.String, Schema.Array(Schema.String)), {
    exact: true,
  }),
})

const resolvedSnapshotSchema = Schema.Struct({
  ...agentDefinitionFrontmatterSchema.fields,
  instructions: trimmedString({ min: 1, max: MAX_INSTRUCTION_BYTES }),
  scope: enumeration('project', 'portable-project', 'user'),
  sourcePath: nonEmptyString,
  contentDigest: sha256Digest,
})

/** Decodes like the published schema: an undeclared key is refused, every issue named by path. */
function decodeFrontmatter<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
  const decoded = Schema.decodeUnknownEither(schema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(value)
  if (Either.isLeft(decoded)) {
    throw new Error(`Invalid Agent definition: ${formatParseError(decoded.left).join('; ')}`)
  }
  return decoded.right
}

function assertStandardYamlTag(node: object) {
  const tag = typeof node === 'object' && 'tag' in node ? node.tag : undefined
  if (typeof tag === 'string' && !tag.startsWith('tag:yaml.org,2002:')) {
    throw new Error('Agent definition frontmatter must not use custom YAML tags.')
  }
}

function assertJsonScalar(value: unknown) {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new Error('Agent definition frontmatter contains a non-JSON scalar.')
  }
}

function assertJsonCompatibleYaml(node: unknown): void {
  if (!node) return
  if (isAlias(node)) throw new Error('Agent definition frontmatter must not use YAML aliases.')
  if (typeof node === 'object') assertStandardYamlTag(node)
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
        throw new Error('Agent definition frontmatter keys must be strings.')
      }
      if (pair.key.value === '<<') {
        throw new Error('Agent definition frontmatter must not use YAML merge keys.')
      }
      assertJsonCompatibleYaml(pair.value)
    }
    return
  }
  if (isSeq(node)) {
    for (const item of node.items) assertJsonCompatibleYaml(item)
    return
  }
  if (!isScalar(node)) throw new Error('Agent definition frontmatter must be JSON-compatible.')
  assertJsonScalar(node.value)
}

function splitDocument(markdown: string) {
  if (Buffer.byteLength(markdown, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new Error('Agent definition exceeds 128 KiB.')
  }
  const normalized = markdown.replaceAll('\r\n', '\n').trimStart()
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized)
  if (!match) throw new Error('Agent definition requires terminated YAML frontmatter.')
  const [, frontmatter = '', instructionSource = ''] = match
  const instructions = instructionSource.trim()
  if (!instructions) throw new Error('Agent definition requires non-empty Markdown instructions.')
  if (Buffer.byteLength(instructions, 'utf8') > MAX_INSTRUCTION_BYTES) {
    throw new Error('Agent definition instructions exceed 64 KiB.')
  }
  return { frontmatter, instructions }
}

export function parseAgentDefinition(markdown: string) {
  const { frontmatter, instructions } = splitDocument(markdown)
  const document = parseDocument(frontmatter, {
    schema: 'core',
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid Agent definition YAML: ${document.errors[0]?.message ?? 'unknown error'}`,
    )
  }
  assertJsonCompatibleYaml(document.contents)
  const raw: unknown = document.toJS({ maxAliasCount: 0 })
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    const parsed = decodeFrontmatter(agentDefinitionFrontmatterSchema, raw)
    return { ...parsed, instructions }
  }

  const pi = decodeFrontmatter(piFrontmatterSchema, raw)
  const rawTools = Array.isArray(pi.tools)
    ? pi.tools
    : typeof pi.tools === 'string'
      ? pi.tools.split(',')
      : []
  const tools = rawTools
    .filter((tool): tool is string => typeof tool === 'string')
    .map((tool) => tool.trim())
    .filter(Boolean)
  return {
    schemaVersion: 1,
    name: pi.name,
    description: pi.description,
    ...(pi.model ? { model: pi.model } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    instructions,
  } satisfies AgentDefinitionDocument
}

export function extractAgentDefinitionDeclaredName(markdown: string) {
  try {
    const { frontmatter } = splitDocument(markdown)
    const document = parseDocument(frontmatter, { schema: 'core', uniqueKeys: true })
    if (document.errors.length > 0) return undefined
    assertJsonCompatibleYaml(document.contents)
    const parsed: unknown = document.toJS({ maxAliasCount: 0 })
    if (typeof parsed !== 'object' || parsed === null || !('name' in parsed)) return undefined
    const name = parsed.name
    return typeof name === 'string' && isAgentDefinitionName(name) ? name : undefined
  } catch {
    return undefined
  }
}

export function resolvedAgentDefinitionSnapshot(
  definition: AgentDefinitionDocument,
  scope: AgentDefinitionScope,
  sourcePath: string,
) {
  return {
    ...definition,
    scope,
    sourcePath,
    contentDigest: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
  }
}

export function parseResolvedAgentDefinitionSnapshot(value: unknown) {
  return decodeFrontmatter(resolvedSnapshotSchema, value) satisfies ResolvedAgentDefinitionSnapshot
}
