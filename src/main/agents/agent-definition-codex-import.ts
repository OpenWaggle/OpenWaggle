import path from 'node:path'
import type { AgentDefinitionDocument } from '@shared/types/agent-definition'
import type { AgentDefinitionImportFieldPlan } from '@shared/types/agent-definition-management'
import { parse } from 'smol-toml'
import { readBoundedAgentDefinitionSource } from './agent-definition-source-reader'

const REASONING_LEVELS: readonly NonNullable<AgentDefinitionDocument['reasoning']>[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

function normalizedName(value: string) {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  return normalized || undefined
}

interface CodexImportInput {
  readonly sourcePath: string
  readonly sourceName?: string
}

async function selectedRecord(input: CodexImportInput, content: string) {
  const root = record(parse(content)) ?? {}
  const agents = record(root.agents)
  if (!agents) return { selected: root, name: input.sourceName }
  const names = Object.keys(agents).sort()
  const selectedName = input.sourceName ?? (names.length === 1 ? names[0] : undefined)
  if (!selectedName) {
    return {
      selected: undefined,
      diagnostic: `Codex config contains ${names.length} Agent entries; select one with --source-name.`,
    }
  }
  const selected = record(agents[selectedName])
  if (!selected) {
    return {
      selected: undefined,
      diagnostic: `Codex Agent ${JSON.stringify(selectedName)} was not found.`,
    }
  }
  const configFile = typeof selected.config_file === 'string' ? selected.config_file : undefined
  if (!configFile) return { selected, name: selectedName }
  const nestedSource = await readBoundedAgentDefinitionSource({
    sourcePath: configFile,
    containingDirectory: path.dirname(input.sourcePath),
  })
  const config = record(parse(nestedSource.content)) ?? {}
  return { selected: { ...selected, ...config }, name: selectedName }
}

function description(source: Readonly<Record<string, unknown>>, name?: string) {
  const sourceValue = typeof source.description === 'string' ? source.description.trim() : ''
  return {
    sourceValue,
    value: sourceValue || (name ? `Imported Codex Agent ${name}.` : undefined),
  }
}

function instructions(source: Readonly<Record<string, unknown>>) {
  const sourceValue =
    typeof source.developer_instructions === 'string'
      ? source.developer_instructions
      : typeof source.instructions === 'string'
        ? source.instructions
        : undefined
  return {
    sourceField: source.developer_instructions ? 'developer_instructions' : 'instructions',
    value: sourceValue?.trim(),
  }
}

function identity(input: {
  readonly selectedName?: string
  readonly sourcePath: string
  readonly source: Readonly<Record<string, unknown>>
  readonly fields: AgentDefinitionImportFieldPlan[]
  readonly diagnostics: string[]
}) {
  const name = normalizedName(
    input.selectedName ?? path.basename(input.sourcePath, path.extname(input.sourcePath)),
  )
  const mappedDescription = description(input.source, name)
  const mappedInstructions = instructions(input.source)
  if (!name) input.diagnostics.push('A valid target Agent name could not be derived.')
  if (!mappedInstructions.value) {
    input.diagnostics.push('The Codex Agent config has no developer_instructions or instructions.')
  }
  if (name) {
    input.fields.push({
      sourceField: input.selectedName ? 'agents.<name>' : '$filename',
      targetField: 'name',
      disposition: 'mapped',
      detail: 'Normalized to an OpenWaggle Agent name.',
      mappedValue: name,
    })
  }
  if (mappedDescription.value) {
    input.fields.push({
      sourceField: mappedDescription.sourceValue ? 'description' : '$default',
      targetField: 'description',
      disposition: mappedDescription.sourceValue ? 'mapped' : 'defaulted',
      detail: mappedDescription.sourceValue ? 'Mapped directly.' : 'The source had no description.',
      mappedValue: mappedDescription.value,
    })
  }
  if (mappedInstructions.value) {
    input.fields.push({
      sourceField: mappedInstructions.sourceField,
      targetField: 'instructions',
      disposition: 'mapped',
      detail: 'Mapped to the Markdown instruction body.',
      mappedValue: mappedInstructions.value,
    })
  }
  return {
    name,
    description: mappedDescription.value,
    instructions: mappedInstructions.value,
  }
}

function modelSettings(
  source: Readonly<Record<string, unknown>>,
  fields: AgentDefinitionImportFieldPlan[],
) {
  const modelValue = typeof source.model === 'string' ? source.model : undefined
  const model = modelValue?.includes('/') ? modelValue : undefined
  if (modelValue) {
    fields.push({
      sourceField: 'model',
      ...(model ? { targetField: 'model', mappedValue: model } : {}),
      disposition: model ? 'mapped' : 'dropped',
      detail: model
        ? 'Mapped directly.'
        : 'Provider-relative model IDs are restrictively omitted; choose provider/model after import.',
      ...(model ? { sourceValue: modelValue } : {}),
    })
  }
  const effort =
    typeof source.model_reasoning_effort === 'string' ? source.model_reasoning_effort : undefined
  const reasoning = REASONING_LEVELS.find((candidate) => candidate === effort)
  if (effort) {
    fields.push({
      sourceField: 'model_reasoning_effort',
      ...(reasoning ? { targetField: 'reasoning', mappedValue: reasoning } : {}),
      disposition: reasoning ? 'mapped' : 'dropped',
      detail: reasoning ? 'Mapped directly.' : 'Unsupported reasoning value.',
      ...(reasoning ? { sourceValue: effort } : {}),
    })
  }
  return { model, reasoning }
}

function dropRemaining(
  source: Readonly<Record<string, unknown>>,
  fields: AgentDefinitionImportFieldPlan[],
) {
  for (const key of Object.keys(source)) {
    if (fields.some((field) => field.sourceField === key)) continue
    const securityPolicy = key === 'sandbox_mode' || key === 'approval_policy'
    fields.push({
      sourceField: key,
      disposition: 'dropped',
      detail: securityPolicy
        ? 'Foreign security policy is never widened automatically; configure OpenWaggle authorization explicitly.'
        : 'No OpenWaggle v1 mapping exists for this Codex field.',
    })
  }
}

export async function mapCodexAgent(input: CodexImportInput, content: string) {
  const selected = await selectedRecord(input, content)
  const fields: AgentDefinitionImportFieldPlan[] = []
  const diagnostics = selected.diagnostic ? [selected.diagnostic] : []
  if (!selected.selected) return { fields, diagnostics }
  const mappedIdentity = identity({
    ...(selected.name ? { selectedName: selected.name } : {}),
    sourcePath: input.sourcePath,
    source: selected.selected,
    fields,
    diagnostics,
  })
  const { model, reasoning } = modelSettings(selected.selected, fields)
  dropRemaining(selected.selected, fields)
  return {
    ...(mappedIdentity.name && mappedIdentity.description && mappedIdentity.instructions
      ? {
          document: {
            schemaVersion: 1 as const,
            name: mappedIdentity.name,
            description: mappedIdentity.description,
            ...(model ? { model } : {}),
            ...(reasoning ? { reasoning } : {}),
            instructions: mappedIdentity.instructions,
          },
        }
      : {}),
    fields,
    diagnostics,
  }
}
