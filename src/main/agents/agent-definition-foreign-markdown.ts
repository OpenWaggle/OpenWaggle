import path from 'node:path'
import type {
  AgentDefinitionDocument,
  AgentDefinitionImportSource,
} from '@shared/types/agent-definition'
import type { AgentDefinitionImportFieldPlan } from '@shared/types/agent-definition-management'
import { parseDocument } from 'yaml'
import { isAgentDefinitionName } from './agent-definition-name'

const FRONTMATTER_BODY_CAPTURE = 2

const REASONING: readonly NonNullable<AgentDefinitionDocument['reasoning']>[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

interface ForeignMarkdownMapping {
  readonly document?: Omit<AgentDefinitionDocument, 'import'>
  readonly fields: readonly AgentDefinitionImportFieldPlan[]
  readonly diagnostics: readonly string[]
}

function split(markdown: string) {
  const normalized = markdown.replaceAll('\r\n', '\n').trimStart()
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized)
  if (!match) return { metadata: {}, body: normalized.trim() }
  const document = parseDocument(match[1] ?? '', { schema: 'core', uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error(`Invalid foreign Agent YAML: ${document.errors[0]?.message ?? 'unknown error'}`)
  }
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Foreign Agent frontmatter must be an object.')
  }
  return {
    metadata: Object.fromEntries(Object.entries(value)),
    body: (match[FRONTMATTER_BODY_CAPTURE] ?? '').trim(),
  }
}

function normalizedName(value: unknown, sourcePath: string) {
  const filename = path
    .basename(sourcePath)
    .replace(/\.agent\.md$/i, '')
    .replace(/\.md$/i, '')
  const raw = typeof value === 'string' && value.trim() ? value.trim() : filename
  const normalized = raw
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  return isAgentDefinitionName(normalized) ? normalized : undefined
}

function stringValue(record: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return { key, value: value.trim() }
  }
  return undefined
}

function mapped(
  sourceField: string,
  targetField: string,
  sourceValue: unknown,
  mappedValue: unknown,
  detail = 'Mapped directly.',
): AgentDefinitionImportFieldPlan {
  return { sourceField, targetField, disposition: 'mapped', detail, sourceValue, mappedValue }
}

function dropped(sourceField: string, _sourceValue: unknown, detail: string) {
  return {
    sourceField,
    disposition: 'dropped',
    detail,
  } satisfies AgentDefinitionImportFieldPlan
}

function mapIdentity(input: {
  readonly metadata: Readonly<Record<string, unknown>>
  readonly sourcePath: string
  readonly sourceTool: string
  readonly fields: AgentDefinitionImportFieldPlan[]
  readonly diagnostics: string[]
}) {
  const name = normalizedName(input.metadata.name, input.sourcePath)
  if (!name) {
    input.diagnostics.push('A valid target Agent name could not be derived.')
    return {}
  }
  input.fields.push(
    mapped(input.metadata.name ? 'name' : '$filename', 'name', input.metadata.name, name),
  )
  const source = stringValue(input.metadata, ['description', 'summary'])
  const description = source?.value ?? `Imported ${input.sourceTool} Agent ${name}.`
  input.fields.push(
    source
      ? mapped(source.key, 'description', source.value, description)
      : {
          sourceField: '$default',
          targetField: 'description',
          disposition: 'defaulted',
          detail: 'The source had no description.',
          mappedValue: description,
        },
  )
  return { name, description }
}

function mapInstructions(input: {
  readonly metadata: Readonly<Record<string, unknown>>
  readonly body: string
  readonly fields: AgentDefinitionImportFieldPlan[]
  readonly diagnostics: string[]
}) {
  const source = stringValue(input.metadata, [
    'instructions',
    'systemPrompt',
    'system_prompt',
    'prompt',
  ])
  const instructions = input.body || source?.value
  if (!instructions) {
    input.diagnostics.push('The source has no Markdown body or instruction field.')
    return undefined
  }
  input.fields.push(
    mapped(
      input.body ? '$body' : (source?.key ?? '$body'),
      'instructions',
      input.body || source?.value,
      instructions,
    ),
  )
  return instructions
}

function mapOptionalMetadata(
  metadata: Readonly<Record<string, unknown>>,
  fields: AgentDefinitionImportFieldPlan[],
) {
  const modelSource = stringValue(metadata, ['model'])
  const model = modelSource?.value.includes('/') ? modelSource.value : undefined
  if (modelSource) {
    fields.push(
      model
        ? mapped(modelSource.key, 'model', modelSource.value, model)
        : dropped(
            modelSource.key,
            modelSource.value,
            'Provider-relative model aliases are omitted; choose an OpenWaggle provider/model ID after import.',
          ),
    )
  }
  const reasoningSource = stringValue(metadata, ['reasoning', 'reasoningEffort'])
  const reasoning = REASONING.find((candidate) => candidate === reasoningSource?.value)
  if (reasoningSource) {
    fields.push(
      reasoning
        ? mapped(reasoningSource.key, 'reasoning', reasoningSource.value, reasoning)
        : dropped(reasoningSource.key, reasoningSource.value, 'Unsupported reasoning value.'),
    )
  }
  const workspace = metadata.isolation === 'worktree' ? ('new-worktree' as const) : undefined
  if (metadata.isolation !== undefined) {
    fields.push(
      workspace
        ? mapped('isolation', 'workspace', metadata.isolation, workspace)
        : dropped('isolation', metadata.isolation, 'Unsupported isolation mode.'),
    )
  }
  return { model, reasoning, workspace }
}

function dropForeignCapabilities(
  metadata: Readonly<Record<string, unknown>>,
  fields: AgentDefinitionImportFieldPlan[],
) {
  for (const key of ['tools', 'disallowedTools', 'skills', 'mcpServers', 'mcp-servers']) {
    if (metadata[key] === undefined) continue
    fields.push(
      dropped(
        key,
        metadata[key],
        'Foreign capability names are restrictively omitted; review and add OpenWaggle names explicitly.',
      ),
    )
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (fields.some((field) => field.sourceField === key)) continue
    fields.push(dropped(key, value, 'No OpenWaggle v1 mapping exists for this field.'))
  }
}

export function mapForeignMarkdownAgent(input: {
  readonly sourceTool: Exclude<AgentDefinitionImportSource, 'openwaggle' | 'codex'>
  readonly sourcePath: string
  readonly markdown: string
}): ForeignMarkdownMapping {
  const { metadata, body } = split(input.markdown)
  const fields: AgentDefinitionImportFieldPlan[] = []
  const diagnostics: string[] = []
  const { name, description } = mapIdentity({ ...input, metadata, fields, diagnostics })
  const instructions = mapInstructions({ metadata, body, fields, diagnostics })
  const { model, reasoning, workspace } = mapOptionalMetadata(metadata, fields)
  dropForeignCapabilities(metadata, fields)
  return {
    ...(name && description && instructions
      ? {
          document: {
            schemaVersion: 1,
            name,
            description,
            ...(model ? { model } : {}),
            ...(reasoning ? { reasoning } : {}),
            ...(workspace ? { workspace } : {}),
            instructions,
          },
        }
      : {}),
    fields,
    diagnostics,
  }
}
