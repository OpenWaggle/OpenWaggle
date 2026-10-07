import type { McpSecretSummary } from '@shared/types/mcp'
import { Plus, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import type { McpKeyValueRow } from '../../../lib/mcp-add-server-form'

function newRow(): McpKeyValueRow {
  return { id: crypto.randomUUID(), key: '', value: '', secret: false }
}

function ValueInput({
  row,
  label,
  secrets,
  onChange,
}: {
  readonly row: McpKeyValueRow
  readonly label: string
  readonly secrets: readonly McpSecretSummary[]
  readonly onChange: (row: McpKeyValueRow) => void
}) {
  if (!row.secret) {
    return (
      <TextInput
        inputSize="sm"
        monospace
        aria-label={`${label} value`}
        placeholder="value or ${ENV_VAR}"
        value={row.value}
        onChange={(event) => onChange({ ...row, value: event.target.value })}
      />
    )
  }
  return (
    <Select
      aria-label={`${label} secret`}
      className="w-full"
      value={row.value}
      onChange={(event) => onChange({ ...row, value: event.target.value })}
    >
      <option value="">Choose a secret</option>
      {secrets.map((secret) => (
        <option key={secret.name} value={secret.name}>
          {secret.name}
        </option>
      ))}
    </Select>
  )
}

/** Environment variables of a command, or headers of a URL server. */
export function McpKeyValueRows({
  label,
  rows,
  secrets,
  allowSecrets,
  onChange,
}: {
  readonly label: string
  readonly rows: readonly McpKeyValueRow[]
  readonly secrets: readonly McpSecretSummary[]
  readonly allowSecrets: boolean
  readonly onChange: (rows: readonly McpKeyValueRow[]) => void
}) {
  const update = (next: McpKeyValueRow) =>
    onChange(rows.map((row) => (row.id === next.id ? next : row)))
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => {
        const rowLabel = `${label} ${String(index + 1)}`
        return (
          <div
            key={row.id}
            className="grid grid-cols-[10rem_minmax(0,1fr)_auto_auto] items-center gap-2"
          >
            <TextInput
              inputSize="sm"
              monospace
              aria-label={`${rowLabel} name`}
              placeholder="NAME"
              value={row.key}
              onChange={(event) => update({ ...row, key: event.target.value })}
            />
            <ValueInput row={row} label={rowLabel} secrets={secrets} onChange={update} />
            <Checkbox
              label="Secret"
              labelClassName="text-xs"
              checked={row.secret}
              disabled={!allowSecrets && !row.secret}
              onChange={(event) => update({ ...row, secret: event.target.checked, value: '' })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${rowLabel}`}
              onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )
      })}
      <Button
        variant="ghost"
        size="xs"
        leftIcon={<Plus className="size-3" />}
        onClick={() => onChange([...rows, newRow()])}
      >
        Add {label.toLowerCase()}
      </Button>
    </div>
  )
}
