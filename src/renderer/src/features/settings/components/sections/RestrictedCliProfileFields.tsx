import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  type AgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { Textarea } from '@/shared/ui/Textarea'

const SCOPE_TEXTAREA_ROWS = 3

function capabilityLabel(capability: SessionCapability) {
  return capability
    .split(':')
    .map((part) => part.replaceAll('-', ' '))
    .join(' · ')
}

export function RestrictedProfileAuthorizationField(props: {
  readonly value: AgentAuthorizationMode
  readonly onChange: (value: AgentAuthorizationMode) => void
}) {
  return (
    <label
      className="block space-y-1.5 text-xs font-medium text-text-secondary"
      htmlFor="restricted-profile-authorization"
    >
      Authorization ceiling
      <Select
        id="restricted-profile-authorization"
        value={props.value}
        onChange={(event) =>
          props.onChange(event.currentTarget.value === 'yolo' ? 'yolo' : 'ask-for-approval')
        }
      >
        <option value="ask-for-approval">
          {AGENT_AUTHORIZATION_MODE_LABELS['ask-for-approval']}
        </option>
        <option value="yolo">{AGENT_AUTHORIZATION_MODE_LABELS.yolo}</option>
      </Select>
    </label>
  )
}

export function RestrictedProfileScopeFields(props: {
  readonly all: boolean
  readonly projectPaths: string
  readonly sessionIds: string
  readonly hiveRootSessionIds: string
  readonly onAllChange: (value: boolean) => void
  readonly onProjectPathsChange: (value: string) => void
  readonly onSessionIdsChange: (value: string) => void
  readonly onHiveRootSessionIdsChange: (value: string) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-text-secondary">Allowed scope</legend>
      <Checkbox
        checked={props.all}
        label="All Sessions and projects"
        onChange={(event) => props.onAllChange(event.currentTarget.checked)}
      />
      {!props.all ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label
            className="space-y-1 text-xs text-text-tertiary"
            htmlFor="restricted-profile-project-paths"
          >
            Projects, one path per line
            <Textarea
              id="restricted-profile-project-paths"
              rows={SCOPE_TEXTAREA_ROWS}
              value={props.projectPaths}
              onChange={(event) => props.onProjectPathsChange(event.currentTarget.value)}
            />
          </label>
          <label
            className="space-y-1 text-xs text-text-tertiary"
            htmlFor="restricted-profile-session-ids"
          >
            Session IDs
            <Textarea
              id="restricted-profile-session-ids"
              rows={SCOPE_TEXTAREA_ROWS}
              value={props.sessionIds}
              onChange={(event) => props.onSessionIdsChange(event.currentTarget.value)}
            />
          </label>
          <label
            className="space-y-1 text-xs text-text-tertiary"
            htmlFor="restricted-profile-hive-root-ids"
          >
            Hive root IDs
            <Textarea
              id="restricted-profile-hive-root-ids"
              rows={SCOPE_TEXTAREA_ROWS}
              value={props.hiveRootSessionIds}
              onChange={(event) => props.onHiveRootSessionIdsChange(event.currentTarget.value)}
            />
          </label>
        </div>
      ) : null}
    </fieldset>
  )
}

export function RestrictedProfileCapabilityFields(props: {
  readonly selected: readonly SessionCapability[]
  readonly onToggle: (capability: SessionCapability, checked: boolean) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-text-secondary">Capabilities</legend>
      <div className="grid gap-x-4 gap-y-2 rounded-lg border border-border p-3 sm:grid-cols-2">
        {SESSION_CAPABILITIES.map((capability) => (
          <Checkbox
            key={capability}
            checked={props.selected.includes(capability)}
            label={capabilityLabel(capability)}
            onChange={(event) => props.onToggle(capability, event.currentTarget.checked)}
          />
        ))}
      </div>
      {props.selected.includes('access:profiles') ? (
        <p className="text-xs leading-5 text-text-tertiary">
          This profile may create only narrower profiles inside its own capabilities, scope, and
          Authorization ceiling. Only the local user can grant this capability.
        </p>
      ) : null}
    </fieldset>
  )
}
