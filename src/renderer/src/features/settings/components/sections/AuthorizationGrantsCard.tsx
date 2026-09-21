import {
  AGENT_AUTHORIZATION_CAPABILITY_LABELS,
  authorizationScopeKeyId,
  type ScopedAuthorizationGrant,
} from '@shared/types/agent-authorization-grants'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'

const logger = createRendererLogger('agent-access-grants')

function useProjectAuthorizationGrants(projectPath: string | null) {
  const [grants, setGrants] = useState<readonly ScopedAuthorizationGrant[]>([])
  const [loading, setLoading] = useState(Boolean(projectPath))
  const [error, setError] = useState(false)
  const [retryRevision, setRetryRevision] = useState(0)

  useEffect(() => {
    if (!projectPath || typeof api.listAuthorizationGrants !== 'function') {
      setGrants([])
      setError(false)
      setLoading(false)
      return
    }

    // Cancellation matters more here than on a normal read: every row offers Revoke bound to the
    // *current* project, so painting a slower response for a previous project would invite revoking
    // a grant that is listed but belongs somewhere else.
    let cancelled = false
    setLoading(true)
    setError(false)
    api
      .listAuthorizationGrants(projectPath)
      .then((next) => {
        if (!cancelled) {
          setGrants(next)
          setError(false)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        logger.warn('Failed to load authorization grants', {
          error: String(err),
          attempt: retryRevision + 1,
        })
        setGrants([])
        setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, retryRevision])

  return { grants, loading, error, reload: () => setRetryRevision((revision) => revision + 1) }
}

function grantDescription(grant: ScopedAuthorizationGrant) {
  const capability = AGENT_AUTHORIZATION_CAPABILITY_LABELS[grant.capability]
  return grant.resource ? `${capability} · ${grant.resource}` : capability
}

function AuthorizationGrantRow({
  grant,
  projectPath,
  onRevoked,
}: {
  readonly grant: ScopedAuthorizationGrant
  readonly projectPath: string
  readonly onRevoked: () => void
}) {
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleRevoke() {
    if (revoking || typeof api.revokeAuthorization !== 'function') return

    setError(null)
    setRevoking(true)
    api
      .revokeAuthorization(projectPath, {
        requester: grant.requester,
        requesterId: grant.requesterId,
        capability: grant.capability,
        ...(grant.resource === undefined ? {} : { resource: grant.resource }),
      })
      .then(onRevoked)
      .catch((err: unknown) => {
        logger.warn('Failed to revoke authorization grant', { error: String(err) })
        // Revoking is a security action, and a silent failure looks exactly like a click that did
        // not register: the row stays, so the natural assumption is that it worked.
        setError('Could not revoke this approval. It is still in effect.')
      })
      .finally(() => {
        setRevoking(false)
      })
  }

  return (
    <div className="flex min-h-14 flex-col gap-1 border-b border-border px-5 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs font-medium text-text-primary">{grant.requester}</span>
          <span className="truncate text-xs text-text-tertiary">{grantDescription(grant)}</span>
        </div>
        <Button
          aria-label={`Revoke ${grantDescription(grant)} for ${grant.requester}`}
          disabled={revoking}
          onClick={handleRevoke}
          size="sm"
          variant="secondary"
        >
          Revoke
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function AuthorizationGrantsCard({ projectPath }: { readonly projectPath: string | null }) {
  const { grants, loading, error, reload } = useProjectAuthorizationGrants(projectPath)

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-text-primary">Saved approvals</span>
        <span className="text-xs text-text-tertiary">
          Revoking stops future use. It does not recall work already done.
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        {!projectPath ? (
          <p className="px-5 py-3 text-xs text-text-tertiary">
            Open a project to see what it has approved.
          </p>
        ) : error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 px-5 py-3 text-xs text-error-text"
          >
            <span>Could not load saved approvals. Existing approvals may still be in effect.</span>
            <Button size="xs" variant="secondary" onClick={reload}>
              Retry loading approvals
            </Button>
          </div>
        ) : loading ? (
          <p className="px-5 py-3 text-xs text-text-tertiary">Loading saved approvals…</p>
        ) : grants.length === 0 ? (
          <p className="px-5 py-3 text-xs text-text-tertiary">
            This project has no saved approvals. Approvals you keep will appear here.
          </p>
        ) : (
          grants.map((grant) => (
            <AuthorizationGrantRow
              grant={grant}
              key={authorizationScopeKeyId(grant)}
              onRevoked={reload}
              projectPath={projectPath}
            />
          ))
        )}
      </div>
    </div>
  )
}
