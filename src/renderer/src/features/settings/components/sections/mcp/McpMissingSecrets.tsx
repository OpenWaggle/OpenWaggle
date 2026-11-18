import { Button } from '@/shared/ui/Button'

/** "Needs secret X" in a server's list row: the server is left out of Runs until it is added. */
export function McpMissingSecretMarker({ missing }: { readonly missing: readonly string[] }) {
  if (missing.length === 0) return null
  return (
    <>
      {' '}
      <span aria-hidden="true">·</span>{' '}
      <span className="font-medium text-warning">
        Needs secret <span className="font-mono">{missing.join(', ')}</span>
      </span>
    </>
  )
}

/** The detail's notice for each missing secret, with the way to add it under Secrets. */
export function McpMissingSecretNotice({
  missing,
  onAddSecret,
}: {
  readonly missing: readonly string[]
  readonly onAddSecret: (name: string) => void
}) {
  if (missing.length === 0) return null
  return (
    <div role="status" className="space-y-2 rounded-lg border border-border bg-bg px-4 py-3">
      {missing.map((name) => (
        <div key={name} className="flex items-center justify-between gap-4">
          <p className="text-xs leading-5 text-warning">
            Needs secret <span className="font-mono">{name}</span>. Until it is added, this server
            is left out of every Run.
          </p>
          <Button
            variant="secondary"
            size="xs"
            aria-label={`Add ${name} in Secrets`}
            onClick={() => onAddSecret(name)}
          >
            Add in Secrets
          </Button>
        </div>
      ))}
    </div>
  )
}
