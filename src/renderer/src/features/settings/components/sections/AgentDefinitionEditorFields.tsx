import { THINKING_LEVELS } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import type { useAgentDefinitionEditor } from './use-agent-definition-editor'

type EditorState = ReturnType<typeof useAgentDefinitionEditor>
const AGENT_DEFINITION_SCOPES = ['project', 'portable-project', 'user'] as const

export function AgentDefinitionIdentityFields({ state }: { readonly state: EditorState }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-name">
          Name
          <TextInput
            id="agent-name"
            value={state.name}
            onChange={(event) => state.setName(event.currentTarget.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-scope">
          Scope
          <Select
            className="w-full"
            id="agent-scope"
            value={state.scope}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (includes(AGENT_DEFINITION_SCOPES, value)) state.setScope(value)
            }}
          >
            <option value="project">Project</option>
            <option value="portable-project">Portable project</option>
            <option value="user">User</option>
          </Select>
        </label>
      </div>
      <label className="block space-y-1 text-xs text-text-secondary" htmlFor="agent-description">
        Description
        <TextInput
          id="agent-description"
          value={state.description}
          onChange={(event) => state.setDescription(event.currentTarget.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-model">
          Model <span className="text-text-tertiary">(optional provider/model)</span>
          <TextInput
            id="agent-model"
            value={state.model}
            onChange={(event) => state.setModel(event.currentTarget.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-reasoning">
          Reasoning
          <Select
            className="w-full"
            id="agent-reasoning"
            value={state.reasoning}
            onChange={(event) => state.setReasoning(event.currentTarget.value)}
          >
            <option value="">Default</option>
            {THINKING_LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </>
  )
}

function LineListField(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly restricted: boolean
  readonly onRestrictedChange: (restricted: boolean) => void
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-text-secondary" htmlFor={props.id}>
          {props.label} <span className="text-text-tertiary">(one per line)</span>
        </label>
        <Checkbox
          checked={props.restricted}
          label="Restrict"
          labelClassName="text-xs"
          onChange={(event) => props.onRestrictedChange(event.currentTarget.checked)}
        />
      </div>
      <Textarea
        id={props.id}
        className="min-h-24"
        disabled={!props.restricted}
        resize="vertical"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      <p className="text-xs text-text-tertiary">
        {props.restricted ? 'Leave empty to allow none.' : 'Inherited from the parent or defaults.'}
      </p>
    </div>
  )
}

export function AgentDefinitionCapabilityFields({ state }: { readonly state: EditorState }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-authorization">
          Authorization ceiling
          <Select
            className="w-full"
            id="agent-authorization"
            value={state.authorizationMode}
            onChange={(event) => state.setAuthorizationMode(event.currentTarget.value)}
          >
            <option value="">Inherit</option>
            <option value="ask-for-approval">Ask for approval</option>
            <option value="yolo">YOLO</option>
          </Select>
        </label>
        <label className="space-y-1 text-xs text-text-secondary" htmlFor="agent-workspace">
          Workspace
          <Select
            className="w-full"
            id="agent-workspace"
            value={state.workspace}
            onChange={(event) => state.setWorkspace(event.currentTarget.value)}
          >
            <option value="">Default</option>
            <option value="share-parent">Share parent</option>
            <option value="local">Local checkout</option>
            <option value="new-worktree">New worktree</option>
          </Select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LineListField
          id="agent-tools"
          label="Tools"
          value={state.tools}
          restricted={state.restrictTools}
          onRestrictedChange={state.setRestrictTools}
          onChange={state.setTools}
        />
        <LineListField
          id="agent-skills"
          label="Skills"
          value={state.skills}
          restricted={state.restrictSkills}
          onRestrictedChange={state.setRestrictSkills}
          onChange={state.setSkills}
        />
        <LineListField
          id="agent-mcp-servers"
          label="MCP servers"
          value={state.mcpServers}
          restricted={state.restrictMcpServers}
          onRestrictedChange={state.setRestrictMcpServers}
          onChange={state.setMcpServers}
        />
        <LineListField
          id="agent-session-capabilities"
          label="Session capabilities"
          value={state.sessionCapabilities}
          restricted={state.restrictSessionCapabilities}
          onRestrictedChange={state.setRestrictSessionCapabilities}
          onChange={state.setSessionCapabilities}
        />
      </div>
    </>
  )
}
