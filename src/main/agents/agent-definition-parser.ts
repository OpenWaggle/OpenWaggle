import { createHash } from 'node:crypto'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import type {
  AgentDefinitionDocument,
  AgentDefinitionScope,
  ResolvedAgentDefinitionSnapshot,
} from '@shared/types/agent-definition'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'
import { THINKING_LEVELS } from '@shared/types/settings'
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { z } from 'zod'

const MAX_DOCUMENT_BYTES = 128 * 1024
const MAX_INSTRUCTION_BYTES = 64 * 1024
const MAX_LIST_ITEMS = 128
const MAX_DESCRIPTION_CHARACTERS = 500
const MAX_MODEL_ID_CHARACTERS = 200
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/

const frontmatterSchema = z
  .object({
    schemaVersion: z.literal(1),
    $schema: z.url().optional(),
    name: z.string().regex(NAME_PATTERN),
    description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARACTERS),
    model: z.string().trim().min(1).max(MAX_MODEL_ID_CHARACTERS).optional(),
    reasoning: z.enum(THINKING_LEVELS).optional(),
    tools: z.array(z.string().trim().min(1)).max(MAX_LIST_ITEMS).optional(),
    skills: z.array(z.string().trim().min(1)).max(MAX_LIST_ITEMS).optional(),
    mcpServers: z.array(z.string().trim().min(1)).max(MAX_LIST_ITEMS).optional(),
    sessionCapabilities: z
      .array(z.enum(SESSION_CAPABILITIES))
      .max(SESSION_CAPABILITIES.length)
      .optional(),
    authorizationMode: z.enum(AGENT_AUTHORIZATION_MODES).optional(),
    workspace: z.enum(['share-parent', 'local', 'new-worktree']).optional(),
    import: z
      .object({
        sourceTool: z.enum([
          'openwaggle',
          'codex',
          'claude-code',
          'cursor',
          'gemini-cli',
          'github-copilot',
          'opencode',
        ]),
        sourcePath: z.string().min(1),
        sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        importerVersion: z.literal(1),
        baselineDigest: z.string().regex(/^[a-f0-9]{64}$/),
        importedAt: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()

const resolvedSnapshotSchema = frontmatterSchema.extend({
  instructions: z.string().trim().min(1).max(MAX_INSTRUCTION_BYTES),
  scope: z.enum(['project', 'portable-project', 'user']),
  sourcePath: z.string().min(1),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
})

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

export function parseAgentDefinition(markdown: string): AgentDefinitionDocument {
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
  const parsed = frontmatterSchema.parse(document.toJS({ maxAliasCount: 0 }))
  return { ...parsed, instructions }
}

export function extractAgentDefinitionDeclaredName(markdown: string): string | undefined {
  try {
    const { frontmatter } = splitDocument(markdown)
    const document = parseDocument(frontmatter, { schema: 'core', uniqueKeys: true })
    if (document.errors.length > 0) return undefined
    assertJsonCompatibleYaml(document.contents)
    const parsed = document.toJS({ maxAliasCount: 0 })
    if (typeof parsed !== 'object' || parsed === null || !('name' in parsed)) return undefined
    const name = (parsed as { readonly name?: unknown }).name
    return typeof name === 'string' && NAME_PATTERN.test(name) ? name : undefined
  } catch {
    return undefined
  }
}

export function resolvedAgentDefinitionSnapshot(
  definition: AgentDefinitionDocument,
  scope: AgentDefinitionScope,
  sourcePath: string,
): ResolvedAgentDefinitionSnapshot {
  return {
    ...definition,
    scope,
    sourcePath,
    contentDigest: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
  }
}

export function parseResolvedAgentDefinitionSnapshot(value: unknown) {
  return resolvedSnapshotSchema.parse(value) satisfies ResolvedAgentDefinitionSnapshot
}
