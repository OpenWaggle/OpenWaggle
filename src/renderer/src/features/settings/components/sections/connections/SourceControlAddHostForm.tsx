import { type SourceControlProviderId, sourceControlHostKey } from '@shared/types/git'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { TextInput } from '@/shared/ui/TextInput'
import { SOURCE_CONTROL_PROVIDER_OPTIONS } from './source-control-providers'
import { useSourceControlConfigure } from './use-source-control-configure'

export function SourceControlAddHostForm({ onDone }: { readonly onDone: () => void }) {
  const { configure, pending } = useSourceControlConfigure()
  const [host, setHost] = useState('')
  const [provider, setProvider] = useState<SourceControlProviderId>('github')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const key = sourceControlHostKey(host)
    if (key.length === 0 || pending) return
    setError(null)
    const result = await configure({ kind: 'set-host-provider', host: key, provider })
    if (result.ok) onDone()
    else setError(result.message)
  }

  return (
    <form
      className="space-y-2 px-5 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="source-control-add-host">
          Hostname
        </label>
        <TextInput
          id="source-control-add-host"
          inputSize="sm"
          placeholder="git.example.com"
          value={host}
          autoFocus
          onChange={(event) => setHost(event.target.value)}
        />
        <label className="sr-only" htmlFor="source-control-add-provider">
          Provider
        </label>
        <Select
          id="source-control-add-provider"
          selectSize="sm"
          value={provider}
          onChange={(event) => {
            const next = SOURCE_CONTROL_PROVIDER_OPTIONS.find(
              (option) => option.id === event.target.value,
            )
            if (next) setProvider(next.id)
          }}
        >
          {SOURCE_CONTROL_PROVIDER_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={pending || host.trim().length === 0}>
          Add
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-error-text">
          {error}
        </p>
      ) : null}
    </form>
  )
}
