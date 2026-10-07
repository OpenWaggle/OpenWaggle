import type { McpConfigFileScope, McpConfigurationView } from '@shared/types/mcp-configuration'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import { useMcpConfigurationActions } from '../../../hooks/useMcpConfiguration'
import { useMcpSecrets } from '../../../hooks/useMcpImports'
import {
  buildMcpServerEntry,
  canUseVaultSecrets,
  emptyMcpAddServerDraft,
  type McpAddServerDraft,
} from '../../../lib/mcp-add-server-form'
import { mcpDefaultDestination, mcpDestinationFiles } from '../../../lib/mcp-server-model'
import { McpKeyValueRows } from './McpKeyValueRows'
import { McpFileName, McpInlineError } from './McpLabels'

const ARGUMENT_ROWS = 3

function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-text-secondary">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

function DestinationFields({
  view,
  draft,
  onChange,
}: {
  readonly view: McpConfigurationView
  readonly draft: McpAddServerDraft
  readonly onChange: (draft: McpAddServerDraft) => void
}) {
  const files = mcpDestinationFiles(view.files, draft.scope)
  const replaces = view.servers.some(
    (server) => server.name === draft.name.trim() && server.source.fileId === draft.destination,
  )
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Use in">
        {(id) => (
          <Select
            id={id}
            className="w-full"
            value={draft.scope}
            onChange={(event) => {
              const scope: McpConfigFileScope =
                event.target.value === 'project' ? 'project' : 'global'
              onChange({ ...draft, scope, destination: mcpDefaultDestination(scope) })
            }}
          >
            <option value="global">All projects</option>
            <option value="project" disabled={view.projectPath === null}>
              This project
            </option>
          </Select>
        )}
      </Field>
      <Field label="Save to">
        {(id) => (
          <Select
            id={id}
            className="w-full"
            value={draft.destination}
            onChange={(event) => {
              const file = files.find((candidate) => candidate.fileId === event.target.value)
              if (file) onChange({ ...draft, destination: file.fileId })
            }}
          >
            {files.map((file) => (
              <option key={file.fileId} value={file.fileId}>
                <McpFileName fileId={file.fileId} />
                {file.openWaggleOwned ? ' (recommended)' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {replaces ? (
        <p className="col-span-2 text-xs text-warning">
          A server with this name is already in that file. Adding replaces it.
        </p>
      ) : null}
    </div>
  )
}

function TransportFields({
  draft,
  onChange,
}: {
  readonly draft: McpAddServerDraft
  readonly onChange: (draft: McpAddServerDraft) => void
}) {
  if (draft.kind === 'url') {
    return (
      <Field label="URL">
        {(id) => (
          <TextInput
            id={id}
            monospace
            placeholder="https://example.com/mcp"
            value={draft.url}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
          />
        )}
      </Field>
    )
  }
  return (
    <>
      <Field label="Command">
        {(id) => (
          <TextInput
            id={id}
            monospace
            placeholder="npx"
            value={draft.command}
            onChange={(event) => onChange({ ...draft, command: event.target.value })}
          />
        )}
      </Field>
      <Field label="Arguments, one per line">
        {(id) => (
          <Textarea
            id={id}
            variant="mono"
            rows={ARGUMENT_ROWS}
            placeholder={'-y\n@modelcontextprotocol/server-filesystem\n.'}
            value={draft.args}
            onChange={(event) => onChange({ ...draft, args: event.target.value })}
          />
        )}
      </Field>
    </>
  )
}

export function McpAddServerForm({
  view,
  onDone,
}: {
  readonly view: McpConfigurationView
  readonly onDone: (name: string | null) => void
}) {
  const actions = useMcpConfigurationActions(view.projectPath)
  const { secrets } = useMcpSecrets()
  const [draft, setDraft] = useState(() => emptyMcpAddServerDraft('global'))
  const [formError, setFormError] = useState<string | null>(null)

  async function submit() {
    const built = buildMcpServerEntry(draft)
    if (!built.ok) {
      setFormError(built.error)
      return
    }
    setFormError(null)
    const name = draft.name.trim()
    const saved = await actions.addServer({
      name,
      scope: draft.scope,
      destination: draft.destination,
      entry: built.entry,
    })
    if (saved) onDone(name)
  }

  return (
    <form
      aria-label="Add server"
      className="space-y-3 rounded-lg border border-border bg-bg px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          {(id) => (
            <TextInput
              id={id}
              monospace
              placeholder="filesystem"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          )}
        </Field>
        <Field label="Connects with">
          {(id) => (
            <Select
              id={id}
              className="w-full"
              value={draft.kind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  kind: event.target.value === 'url' ? 'url' : 'command',
                  variables: [],
                })
              }
            >
              <option value="command">A command (stdio)</option>
              <option value="url">A URL (HTTP)</option>
            </Select>
          )}
        </Field>
      </div>
      <TransportFields draft={draft} onChange={setDraft} />
      <McpKeyValueRows
        label={draft.kind === 'url' ? 'Header' : 'Variable'}
        rows={draft.variables}
        secrets={secrets}
        allowSecrets={canUseVaultSecrets(draft)}
        onChange={(variables) => setDraft({ ...draft, variables })}
      />
      <Field label="Description (optional)">
        {(id) => (
          <TextInput
            id={id}
            placeholder="What the server offers, in a sentence"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        )}
      </Field>
      <DestinationFields view={view} draft={draft} onChange={setDraft} />
      <McpInlineError message={formError ?? actions.error} />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={actions.pending}>
          Add server
        </Button>
      </div>
    </form>
  )
}
