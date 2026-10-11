import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { useMcpSecrets } from '../../../hooks/useMcpImports'
import { McpInlineError } from './McpLabels'

/** The encrypted vault: a server saved in OpenWaggle's files can read a value from it. */
export function McpSecretsPanel({
  requestedName,
  onSaved,
}: {
  /** A secret a server needs, from its "Add in Secrets": filled in, with its value to type. */
  readonly requestedName?: string | undefined
  readonly onSaved?: () => void
} = {}) {
  const vault = useMcpSecrets()
  const saving = vault.pendingOperation?.kind === 'save'
  const deleting = (name: string) =>
    vault.pendingOperation?.kind === 'remove' && vault.pendingOperation.name === name
  const [name, setName] = useState(requestedName ?? '')
  const [value, setValue] = useState('')
  return (
    <section aria-labelledby="mcp-secrets-heading" className="space-y-3">
      <div>
        <h3 id="mcp-secrets-heading" className="text-sm font-semibold text-text-primary">
          Secrets
        </h3>
        <p className="mt-0.5 text-xs text-text-tertiary">
          Stored encrypted on this computer. A server saved in OpenWaggle&apos;s files can use one
          as a variable or header value.
        </p>
      </div>
      {vault.secrets.length > 0 ? (
        <ul aria-label="Secrets" className="overflow-hidden rounded-lg border border-border bg-bg">
          {vault.secrets.map((secret) => (
            <li
              key={secret.name}
              className="flex items-center justify-between gap-4 border-b border-border px-4 py-2 last:border-b-0"
            >
              <span className="font-mono text-xs text-text-primary">{secret.name}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${deleting(secret.name) ? 'Deleting' : 'Delete'} secret ${secret.name}`}
                aria-busy={deleting(secret.name)}
                disabled={vault.pending}
                onClick={() => vault.remove(secret.name)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        aria-label="Add secret"
        className="flex items-center gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          if (await vault.save(name.trim(), value)) {
            onSaved?.()
            setName('')
            setValue('')
          }
        }}
      >
        <TextInput
          inputSize="sm"
          monospace
          aria-label="Secret name"
          placeholder="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextInput
          inputSize="sm"
          type="password"
          aria-label="Secret value"
          autoFocus={requestedName !== undefined}
          placeholder="value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={vault.pending || !name.trim() || !value}
          aria-busy={saving}
        >
          {/* Saving asks the system keychain, which may take a while or show a prompt. */}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <McpInlineError message={vault.loadError ?? vault.error} />
    </section>
  )
}
