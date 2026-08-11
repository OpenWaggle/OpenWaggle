import type { McpDoctorResult, McpSecretSummary } from '@shared/types/mcp'
import { Activity, AlertTriangle, CheckCircle2, CircleOff, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { StatusPill } from './McpSectionPanelPrimitives'

const MCP_SECRET_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function doctorIcon(status: McpDoctorResult['checks'][number]['status']) {
  if (status === 'pass') return <CheckCircle2 className="size-3.5 text-emerald-300" />
  if (status === 'warning') return <AlertTriangle className="size-3.5 text-amber-300" />
  return <CircleOff className="size-3.5 text-error" />
}

export function McpDoctorPanel({ doctor }: { readonly doctor: McpDoctorResult | null }) {
  if (!doctor) return null
  return (
    <section aria-labelledby="mcp-doctor-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-text-tertiary" />
        <h3 id="mcp-doctor-heading" className="text-[15px] font-semibold text-text-primary">
          Runtime diagnostics
        </h3>
        <StatusPill tone={doctor.ok ? 'success' : 'warning'}>
          {doctor.ok ? 'Ready' : 'Attention needed'}
        </StatusPill>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-[#111418]">
        {doctor.checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2.5 px-3 py-2.5">
            <span className="mt-0.5">{doctorIcon(check.status)}</span>
            <div>
              <p className="text-[12px] text-text-secondary">{check.message}</p>
              {check.action && (
                <p className="mt-0.5 text-[11px] text-text-muted">Next: {check.action}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatSecretDate(timestamp: number) {
  return MCP_SECRET_DATE_FORMATTER.format(new Date(timestamp))
}

export function McpSecretVault({
  secrets,
  busy,
  onSave,
  onRemove,
}: {
  readonly secrets: readonly McpSecretSummary[]
  readonly busy: boolean
  readonly onSave: (name: string, value: string) => Promise<void>
  readonly onRemove: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  async function save() {
    const normalizedName = name.trim()
    if (!normalizedName || !value) return
    await onSave(normalizedName, value)
    setName('')
    setValue('')
  }
  return (
    <section aria-labelledby="mcp-vault-heading" className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-text-tertiary" />
          <h3 id="mcp-vault-heading" className="text-[15px] font-semibold text-text-primary">
            Secret vault
          </h3>
        </div>
        <p className="mt-1 text-[12px] text-text-tertiary">
          Values are encrypted by the operating system and never returned to the renderer. Reference
          one in JSON as{' '}
          <code className="font-mono text-text-secondary">{'{"secret":"NAME"}'}</code>.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-[#111418] p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2">
          <TextInput
            value={name}
            inputSize="sm"
            placeholder="Secret name"
            aria-label="MCP secret name"
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          <TextInput
            value={value}
            inputSize="sm"
            type="password"
            placeholder="Secret value"
            aria-label="MCP secret value"
            autoComplete="new-password"
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            variant="accent"
            disabled={busy || !name.trim() || !value}
            onClick={() => void save()}
          >
            Save secret
          </Button>
        </div>
        {secrets.length > 0 ? (
          <div className="mt-3 divide-y divide-border border-t border-border">
            {secrets.map((secret) => (
              <div key={secret.name} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="font-mono text-[12px] text-text-primary">{secret.name}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    Updated {formatSecretDate(secret.updatedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => onRemove(secret.name)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 border-t border-border pt-3 text-[11px] text-text-muted">
            No saved MCP secrets.
          </p>
        )}
      </div>
    </section>
  )
}
