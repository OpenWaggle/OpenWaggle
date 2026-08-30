import {
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type {
  AgentDefinitionCatalogItem,
  AgentDefinitionDocument,
  AgentDefinitionScope,
} from '@shared/types/agent-definition'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { useState } from 'react'

export interface AgentDefinitionEditorDialogProps {
  readonly source?: AgentDefinitionCatalogItem
  readonly duplicate?: boolean
  readonly onClose: () => void
  readonly onSave: (input: {
    readonly scope: AgentDefinitionScope
    readonly document: AgentDefinitionDocument
    readonly replaceExisting: boolean
    readonly expectedContentDigest?: string
  }) => Promise<void>
}

const AGENT_WORKSPACES = ['share-parent', 'local', 'new-worktree'] as const
type AgentWorkspace = NonNullable<AgentDefinitionDocument['workspace']>

function lines(value: string) {
  const items = value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

function knownCapabilities(value: string) {
  const parsed = lines(value)
  if (!parsed) return undefined
  const invalid = parsed.filter((item) => !includes(SESSION_CAPABILITIES, item))
  if (invalid.length > 0) {
    throw new Error(`Unknown Session capabilities: ${invalid.join(', ')}`)
  }
  return parsed.filter((item): item is SessionCapability => includes(SESSION_CAPABILITIES, item))
}

function restrictedLines(value: string, restricted: boolean) {
  return restricted ? (lines(value) ?? []) : undefined
}

function restrictedCapabilities(value: string, restricted: boolean) {
  return restricted ? (knownCapabilities(value) ?? []) : undefined
}

function optionalReasoning(value: string): ThinkingLevel | undefined {
  return includes(THINKING_LEVELS, value) ? value : undefined
}

function optionalAuthorization(value: string): AgentAuthorizationMode | undefined {
  return includes(AGENT_AUTHORIZATION_MODES, value) ? value : undefined
}

function optionalWorkspace(value: string): AgentWorkspace | undefined {
  return includes(AGENT_WORKSPACES, value) ? value : undefined
}

interface EditorValues {
  readonly name: string
  readonly description: string
  readonly model: string
  readonly reasoning: string
  readonly authorizationMode: string
  readonly workspace: string
  readonly tools: string
  readonly restrictTools: boolean
  readonly skills: string
  readonly restrictSkills: boolean
  readonly mcpServers: string
  readonly restrictMcpServers: boolean
  readonly sessionCapabilities: string
  readonly restrictSessionCapabilities: boolean
  readonly instructions: string
}

const EMPTY_DEFINITION: AgentDefinitionDocument = {
  schemaVersion: 1,
  name: '',
  description: '',
  instructions: '',
}

function optionalText(value: string | undefined) {
  return value ?? ''
}

function joined(value: readonly string[] | undefined) {
  return value?.join('\n') ?? ''
}

function initialName(props: AgentDefinitionEditorDialogProps, definition: AgentDefinitionDocument) {
  return props.duplicate && props.source?.definition ? `${definition.name}-copy` : definition.name
}

function initialValues(props: AgentDefinitionEditorDialogProps) {
  const definition = props.source?.definition ?? EMPTY_DEFINITION
  return {
    scope: props.source?.scope ?? ('project' as const),
    name: initialName(props, definition),
    description: definition.description,
    model: optionalText(definition.model),
    reasoning: optionalText(definition.reasoning),
    authorizationMode: optionalText(definition.authorizationMode),
    workspace: optionalText(definition.workspace),
    tools: joined(definition.tools),
    restrictTools: definition.tools !== undefined,
    skills: joined(definition.skills),
    restrictSkills: definition.skills !== undefined,
    mcpServers: joined(definition.mcpServers),
    restrictMcpServers: definition.mcpServers !== undefined,
    sessionCapabilities: joined(definition.sessionCapabilities),
    restrictSessionCapabilities: definition.sessionCapabilities !== undefined,
    instructions: definition.instructions,
  }
}

function useEditorFields(initial: ReturnType<typeof initialValues>) {
  const [scope, setScope] = useState<AgentDefinitionScope>(initial.scope)
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [model, setModel] = useState(initial.model)
  const [reasoning, setReasoning] = useState(initial.reasoning)
  const [authorizationMode, setAuthorizationMode] = useState(initial.authorizationMode)
  const [workspace, setWorkspace] = useState(initial.workspace)
  const [tools, setTools] = useState(initial.tools)
  const [restrictTools, setRestrictTools] = useState(initial.restrictTools)
  const [skills, setSkills] = useState(initial.skills)
  const [restrictSkills, setRestrictSkills] = useState(initial.restrictSkills)
  const [mcpServers, setMcpServers] = useState(initial.mcpServers)
  const [restrictMcpServers, setRestrictMcpServers] = useState(initial.restrictMcpServers)
  const [sessionCapabilities, setSessionCapabilities] = useState(initial.sessionCapabilities)
  const [restrictSessionCapabilities, setRestrictSessionCapabilities] = useState(
    initial.restrictSessionCapabilities,
  )
  const [instructions, setInstructions] = useState(initial.instructions)
  return {
    scope,
    name,
    description,
    model,
    reasoning,
    authorizationMode,
    workspace,
    tools,
    restrictTools,
    skills,
    restrictSkills,
    mcpServers,
    restrictMcpServers,
    sessionCapabilities,
    restrictSessionCapabilities,
    instructions,
    setScope,
    setName,
    setDescription,
    setModel,
    setReasoning,
    setAuthorizationMode,
    setWorkspace,
    setTools,
    setRestrictTools,
    setSkills,
    setRestrictSkills,
    setMcpServers,
    setRestrictMcpServers,
    setSessionCapabilities,
    setRestrictSessionCapabilities,
    setInstructions,
  }
}

function editorTitle(props: AgentDefinitionEditorDialogProps) {
  if (!props.source) return 'Create Agent definition'
  return props.duplicate ? 'Duplicate Agent definition' : 'Edit Agent definition'
}

function document(values: EditorValues): AgentDefinitionDocument {
  const model = values.model.trim()
  const reasoning = optionalReasoning(values.reasoning)
  const authorizationMode = optionalAuthorization(values.authorizationMode)
  const workspace = optionalWorkspace(values.workspace)
  const tools = restrictedLines(values.tools, values.restrictTools)
  const skills = restrictedLines(values.skills, values.restrictSkills)
  const mcpServers = restrictedLines(values.mcpServers, values.restrictMcpServers)
  const sessionCapabilities = restrictedCapabilities(
    values.sessionCapabilities,
    values.restrictSessionCapabilities,
  )
  return {
    schemaVersion: 1,
    $schema: 'https://openwaggle.ai/schemas/agent-definition-v1.schema.json',
    name: values.name.trim(),
    description: values.description.trim(),
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
    ...(sessionCapabilities !== undefined ? { sessionCapabilities } : {}),
    ...(authorizationMode ? { authorizationMode } : {}),
    ...(workspace ? { workspace } : {}),
    instructions: values.instructions.trim(),
  }
}

export function useAgentDefinitionEditor(props: AgentDefinitionEditorDialogProps) {
  const fields = useEditorFields(initialValues(props))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await props.onSave({
        scope: fields.scope,
        replaceExisting: Boolean(props.source && !props.duplicate),
        ...(props.source?.contentDigest && !props.duplicate
          ? { expectedContentDigest: props.source.contentDigest }
          : {}),
        document: document({
          name: fields.name,
          description: fields.description,
          model: fields.model,
          reasoning: fields.reasoning,
          authorizationMode: fields.authorizationMode,
          workspace: fields.workspace,
          tools: fields.tools,
          restrictTools: fields.restrictTools,
          skills: fields.skills,
          restrictSkills: fields.restrictSkills,
          mcpServers: fields.mcpServers,
          restrictMcpServers: fields.restrictMcpServers,
          sessionCapabilities: fields.sessionCapabilities,
          restrictSessionCapabilities: fields.restrictSessionCapabilities,
          instructions: fields.instructions,
        }),
      })
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return {
    title: editorTitle(props),
    ...fields,
    saving,
    error,
    save,
  }
}
